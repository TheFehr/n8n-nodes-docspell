# n8n-nodes-docspell

This is a n8n community node. It lets you use Docspell in your n8n workflows.

Docspell assists in organizing your piles of digital documents, resulting from scanners, e-mails and other sources with minimal effort.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)
[Compatibility](#compatibility)  
[Resources](#resources)  

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

**Item**

- **Get**: fetch the full detail of one item by its ID (tags, attachments, notes, custom fields, correspondents). Chain it after Search with `{{ $json.id }}`.
- **Search**: find items with Docspell's [query language](https://docspell.org/docs/query/). Returns one n8n item per Docspell item. Supports *Return All*, a limit, an offset, searching the trash, and *Include Details* to also resolve tags and attachments.

More operations are planned.

## Credentials

Use the URL of your Docspell instance, your full account name (`collective/username`) and your password. Accounts with two-factor authentication are not supported. The node logs in once and reuses the session until shortly before it expires.

## Compatibility

Last tested with n8n 2.45.5 and Docspell 0.43.0.

## Versioning

The package version mirrors the Docspell it was last tested with: `major.minor` is Docspell's, so `0.43.x` goes with Docspell `0.43`. The patch number is this package's own counter.

- Every change to the node, **including breaking ones**, only bumps the patch. Breaking changes are called out in the release notes, not in the version number. Read the notes before updating.
- When Docspell's major or minor version changes, the next release is `<major>.<minor>.0`, after the nightly compatibility check has passed against the new Docspell.

Versions before `0.43.0` (the single `0.1.0` release) used an independent numbering and were a different, generated node. `0.43.0` is the first release under this scheme; it is numerically higher than `0.1.0`, so updates are not blocked.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [Docspell Introduction](https://docspell.org/docs/)



