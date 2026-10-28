#!/bin/bash
# Full pipeline: build the node, start Docspell (database, REST server, job runner),
# seed documents, then run real workflows in real n8n processes with this package
# installed, and finally the vitest suite against the same instance.
set -euo pipefail

# Load fnm so `node` and `npm` are on PATH (non-interactive bash skips .bashrc).
if command -v fnm &>/dev/null; then
	eval "$(fnm env --shell bash)"
fi

COMPOSE="docker compose -f docker-compose.test.yml"
OUTPUT_FILES="workflow_output.txt update_output.txt update_not_found_output.txt get_output.txt bad_query_output.txt bad_credentials_output.txt not_found_output.txt"

on_exit() {
	EXIT_CODE=$?
	if [ $EXIT_CODE -ne 0 ]; then
		echo "Full pipeline failed with exit code $EXIT_CODE"
		for f in $OUTPUT_FILES; do
			if [ -f "$f" ]; then
				echo "--- $f (without sourcemap noise) ---"
				# grep exits 1 on an empty file; that must not stop the cleanup below.
				grep -v "Sourcemap" "$f" | tail -30 || true
			fi
		done
		echo "--- restserver logs (tail) ---"
		$COMPOSE logs --tail 40 restserver || true
	fi
	echo "Cleaning up..."
	$COMPOSE down -v --remove-orphans || true
	rm -f $OUTPUT_FILES
	exit $EXIT_CODE
}
trap on_exit EXIT

PACKAGE_NAME=$(node -p "require('./package.json').name")

echo "Building the node..."
npm run build

# A previous run killed before its trap could clean up would leave stale data behind.
$COMPOSE down -v --remove-orphans 2>/dev/null || true
$COMPOSE up -d db restserver joex

echo "Seeding Docspell..."
node scripts/seed-docspell.mjs

# Each n8n process is a fresh one-off container: the package is linked into n8n's
# community-nodes folder exactly the way a real install would find it.
LINK_PACKAGE="
  mkdir -p /home/node/.n8n/nodes/node_modules && \
  rm -f \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
  ln -sf /home/node/custom-nodes \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\""

run_in_n8n() {
	$COMPOSE run --rm --entrypoint /bin/sh n8n -c "$LINK_PACKAGE && $1"
}

echo "Running the Item Search workflow..."
run_in_n8n "
  n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/credentials.json && \
  n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/item_search.json && \
  n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/item_search_bad_query.json && \
  n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/item_search_bad_credentials.json && \
  n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/item_get.json && \
  n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/item_get_not_found.json && \
  n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/item_update.json && \
  n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/item_update_not_found.json && \
  n8n execute --id=1
" > workflow_output.txt 2>&1 || {
	echo "❌ The Item Search workflow did not run to completion"
	exit 1
}
if ! grep -q '"status": *"success"' workflow_output.txt; then
	echo "❌ The Item Search workflow did not finish with status success"
	exit 1
fi
# n8n skips a Code node whose input is empty and still reports success, so the
# assertions must have left their marker in the output.
require_markers() {
	local file=$1 label=$2; shift 2
	for marker in "$@"; do
		if ! grep -q "\"verified\": *\"$marker\"" "$file"; then
			echo "❌ $label: the assertion \"$marker\" never ran (an empty result skips it)"
			exit 1
		fi
	done
}

require_markers workflow_output.txt "Item Search workflow" "invoices" "contract with details"
echo "✅ Item Search workflow succeeded (its Code nodes assert the exact results)"

# Imported workflows live in the n8n_data volume, shared with the one-off containers.
run_in_n8n "n8n execute --id=4" > get_output.txt 2>&1 || {
	echo "❌ The Item Get workflow did not run to completion"
	exit 1
}
if ! grep -q '"status": *"success"' get_output.txt; then
	echo "❌ The Item Get workflow did not finish with status success"
	exit 1
fi
require_markers get_output.txt "Item Get workflow" "item detail"
echo "✅ Item Get workflow succeeded (Search -> Get chained through an expression)"

run_in_n8n "n8n execute --id=6" > update_output.txt 2>&1 || {
	echo "❌ The Item Update workflow did not run to completion"
	exit 1
}
if ! grep -q '"status": *"success"' update_output.txt; then
	echo "❌ The Item Update workflow did not finish with status success"
	exit 1
fi
require_markers update_output.txt "Item Update workflow" "item updated" "item restored"
echo "✅ Item Update workflow succeeded (Search -> Update -> Update back, asserted after each)"

# n8n aborts a workflow on the first node error, so failures run in their own process.
expect_failure() {
	local id=$1 label=$2 output_file=$3 expected=$4
	local exit_code=0
	run_in_n8n "n8n execute --id=$id" > "$output_file" 2>&1 || exit_code=$?
	if [ $exit_code -ne 0 ] && grep -qi "$expected" "$output_file"; then
		echo "✅ $label failed as expected, matched: \"$expected\""
	else
		echo "❌ $label did not fail as expected (exit $exit_code); wanted output containing: \"$expected\""
		exit 1
	fi
}

expect_failure 2 "Unparseable query" bad_query_output.txt "search query"
expect_failure 3 "Wrong password" bad_credentials_output.txt "login failed"
expect_failure 5 "Unknown item id" not_found_output.txt "was not found"
expect_failure 7 "Update of an unknown item" update_not_found_output.txt "was not found"

echo "Running the vitest suite..."
npm run test:run

echo "✅ Full pipeline passed"
