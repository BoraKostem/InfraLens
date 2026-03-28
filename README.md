<div align="center">

# AWS Lens

Desktop AWS operator workspace built with Electron, React, and TypeScript. AWS Lens is designed for fast profile switching, region-aware service exploration, embedded terminal workflows, and a handful of opinionated operational surfaces such as Session Hub, Compliance Center, and Terraform drift inspection.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![AWS SDK](https://img.shields.io/badge/AWS_SDK-v3-FF9900.svg?logo=amazon-aws&logoColor=white)](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-required-F69220.svg?logo=pnpm&logoColor=white)](https://pnpm.io/)

<img src="images/overview.png" alt="AWS Lens overview" width="100%" />

</div>

## Overview

AWS Lens reads local AWS profiles, lets you activate a profile and region, and keeps that context synchronized across the UI and the embedded terminal. The app does not try to replace the AWS Console wholesale. It focuses on faster inspection, common actions, cross-account session handling, and a more consolidated operator workflow for services you touch often.

The current implementation is an Electron desktop app with:

- A profile catalog instead of a simple dropdown
- Region-aware service navigation
- Session Hub for saved assume-role targets and temporary STS sessions
- Compliance Center for grouped findings
- Service-specific consoles for common AWS workloads
- An embedded terminal backed by `node-pty` and `xterm`
- A Terraform workspace with drift inspection against live AWS resources
- A beta Observability & Resilience Lab for EKS, ECS, and Terraform analysis, recommendations, and artifact generation

### App Overview

![AWS Lens overview](images/overview.png)
Main application shell with the left navigation, active AWS context, service workspace, and footer terminal toggle.

### Session Hub

![AWS Lens Session Hub](images/session-hub.png)

Cross-account session workspace for saved assume-role targets, active temporary sessions, and terminal handoff.

### Compliance Center

![AWS Lens Compliance Center](images/complience-center.png)

Compliance Center with severity totals, category grouping, filters, and guided findings for the active profile and region.

### Terraform Workspace

![AWS Lens Terraform Workspace](images/terraform-main.png)

Terraform project workspace with project discovery, command actions, resource details, and embedded infrastructure diagram support.

![AWS Lens Terraform Visualization](images/terraform-visualization.png)

Expanded infrastructure visualization for Terraform-managed resources and their relationships.

### Observability & Resilience Lab (Beta)

Observability & Resilience Lab is a beta operator-assistant surface for EKS clusters, ECS services, and Terraform workspaces. It focuses on posture analysis, telemetry gap detection, resilience recommendations, and generated YAML, CLI, Terraform, or JSON artifacts. It may not work as expected, and heuristic findings are labeled accordingly.


## Implemented Areas

The current renderer wires these screens and workspaces:

- Overview
- Direct Resource Access
- Session Hub
- Compliance Center
- Terraform
- EC2
- CloudWatch
- S3
- Lambda
- Auto Scaling
- RDS
- CloudFormation
- CloudTrail
- ECR
- EKS
- ECS
- VPC
- Load Balancers
- Route 53
- Security Groups
- ACM
- IAM
- Identity Center
- SNS
- SQS
- Secrets Manager
- Key Pairs
- STS
- KMS
- WAF

## Key Workflows

### Profile And Region Context

- Reads AWS profiles from the standard local AWS config and credentials files
- Supports selecting a profile from a searchable catalog
- Allows importing config-based profiles into the app flow
- Supports adding credentials-managed profiles from the UI
- Keeps the selected profile or assumed session aligned with the active region

### Session Hub

- Saves assume-role targets locally
- Assumes roles through STS on demand
- Lets you activate an assumed session as the app context
- Tracks session expiration and supports re-assume flows
- Keeps temporary credentials in memory only

### Service Consoles

The codebase includes dedicated main-process AWS modules and renderer consoles for a broad service set. The app is strongest where it combines inventory views with targeted operator actions rather than mirroring every AWS Console surface.

Examples from the current implementation:

- EC2, CloudWatch, and CloudTrail inspection flows
- S3 bucket, object, and governance-oriented views
- ECS and EKS workflows with terminal handoff support
- Observability & Resilience Lab analysis for EKS, ECS, and Terraform with generator-first outputs
- Route 53 record workflows
- IAM, Identity Center, KMS, Secrets Manager, and WAF management surfaces
- Load balancer, VPC, and security group navigation

### Compliance Center

The Compliance Center aggregates findings for the active profile and region and groups them by severity and category. The current implementation focuses on surfacing actionable checks, filtering them, and exposing safe remediation paths where the app already supports them.

### Terraform Workspace

- Discovers and manages local Terraform project folders
- Runs Terraform commands from the desktop app
- Tracks long-running apply/destroy operations during app shutdown
- Includes drift inspection logic in [`src/main/terraformDrift.ts`](/C:/Users/bora_/Desktop/Projects/electron_migration/src/main/terraformDrift.ts)
- Exposes shortcuts for AWS console navigation and `terraform state show` from supported drift items

### Observability & Resilience Lab

- Available as a beta panel in EKS, ECS, and Terraform views
- Reuses existing EKS session prep, ECS diagnostics, and Terraform workspace/drift flows
- Produces analysis, findings, recommended actions, safety notes, and correlated signal references
- Generates copyable artifacts such as OTel YAML, awslogs snippets, Terraform snippets, and FIS template JSON
- Favors analysis and generator workflows over one-click infrastructure changes

### Embedded Terminal

- Implemented with `node-pty` and `xterm`
- Shares the active AWS context with the rest of the application
- Supports running follow-up commands from service screens
- Stays available as a bottom panel toggled from the footer

## Architecture

```text
.
|-- assets/
|-- images/
|-- src/
|   |-- main/        # Electron main process, AWS clients, IPC handlers, terminal, Terraform orchestration
|   |-- preload/     # contextBridge API exposed to the renderer
|   `-- renderer/    # React UI and service consoles
|-- electron-builder.yml
|-- electron.vite.config.ts
|-- package.json
`-- tsconfig.json
```

Important entry points:

- [`src/main/main.ts`](/C:/Users/bora_/Desktop/Projects/electron_migration/src/main/main.ts): Electron window creation, app lifecycle, graceful shutdown
- [`src/main/awsIpc.ts`](/C:/Users/bora_/Desktop/Projects/electron_migration/src/main/awsIpc.ts): AWS-related IPC handlers
- [`src/main/terminalIpc.ts`](/C:/Users/bora_/Desktop/Projects/electron_migration/src/main/terminalIpc.ts): PTY lifecycle and terminal bridge
- [`src/main/terraform.ts`](/C:/Users/bora_/Desktop/Projects/electron_migration/src/main/terraform.ts): Terraform command orchestration
- [`src/renderer/src/App.tsx`](/C:/Users/bora_/Desktop/Projects/electron_migration/src/renderer/src/App.tsx): app shell, navigation, profile catalog, service routing
- [`src/preload/index.ts`](/C:/Users/bora_/Desktop/Projects/electron_migration/src/preload/index.ts): renderer-safe Electron bridge

## Local State And Dependencies

AWS Lens relies on your local workstation state rather than a hosted backend.

Reads from:

- `~/.aws/config`
- `~/.aws/credentials`

Stores app data under Electron `userData`, including:

- `session-hub.json`
- `terraform-workspace-state.json`

Optional local tools that complement the app:

- AWS CLI
- Terraform CLI
- `kubectl`
- `docker`

## Prerequisites

- Node.js 20+
- `pnpm`
- Local AWS credentials for the profiles you want to use

Optional:

- Terraform CLI for Terraform workspace features
- AWS CLI for terminal-based verification
- `kubectl` for EKS-related workflows
- `docker` for ECR-related workflows

## Development

Install dependencies:

```powershell
pnpm install
```

Run the app in development:

```powershell
pnpm dev
```

Preview the built app:

```powershell
pnpm preview
```

Type-check the project:

```powershell
pnpm typecheck
```

Build production bundles:

```powershell
pnpm build
```

Build output is written to `out/`.

## Packaging

Create desktop packages:

```powershell
pnpm dist
```

Platform-specific packaging:

```powershell
pnpm dist:win
pnpm dist:mac
pnpm dist:linux
```

Packaged artifacts are written to `release/`.

The current builder config in [`electron-builder.yml`](/C:/Users/bora_/Desktop/Projects/electron_migration/electron-builder.yml) targets:

- Windows: NSIS
- macOS: DMG and ZIP
- Linux: deb and AppImage

`node-pty` is unpacked from ASAR for packaged builds.

## Notes For Contributors

- Renderer code should use the preload bridge rather than direct Node access
- AWS-facing actions live in the Electron main process
- Temporary assumed-role credentials are not persisted to AWS config files
- Terraform support is local-workspace oriented, not remote-service oriented
- The app blocks accidental shutdown while Terraform apply/destroy is active

Additional project guidance lives in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
