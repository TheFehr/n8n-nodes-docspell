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

- **Search**: find items with Docspell's [query language](https://docspell.org/docs/query/). Returns one n8n item per Docspell item. Supports *Return All*, a limit, an offset, searching the trash, and *Include Details* to also resolve tags and attachments.

More operations are planned.

## Credentials

Use the URL of your Docspell instance, your full account name (`collective/username`) and your password. Accounts with two-factor authentication are not supported. The node logs in once and reuses the session until shortly before it expires.

## Compatibility

Last tested with n8n 2.45.4 and Docspell 0.43.0.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [Docspell Introduction](https://docspell.org/docs/)



