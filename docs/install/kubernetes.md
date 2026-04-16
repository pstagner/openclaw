---
summary: "Deploy OpenClaw Gateway to a Kubernetes cluster with Kustomize"
read_when:
  - You want to run OpenClaw on a Kubernetes cluster
  - You want to test OpenClaw in a Kubernetes environment
title: "Kubernetes"
---

# OpenClaw on Kubernetes

A minimal starting point for running OpenClaw on Kubernetes — not a production-ready deployment. It covers the core resources and is meant to be adapted to your environment.

This repo currently has two Kubernetes paths:

- `scripts/k8s/deploy.sh`: a simple Kustomize-based single-gateway deploy
- `scripts/k8s/openclaw-agent-cluster/k3s-up.sh`: this fork's local `k3s`/`k3d` multi-agent cluster flow

If you are working from this fork's collaborative agent-cluster setup, read the update notes in [Fork specific k3s agent cluster](#fork-specific-k3s-agent-cluster) and [Update a live cluster](#update-a-live-cluster) before re-running the script.

## Why not Helm?

OpenClaw is a single container with some config files. The interesting customization is in agent content (markdown files, skills, config overrides), not infrastructure templating. Kustomize handles overlays without the overhead of a Helm chart. If your deployment grows more complex, a Helm chart can be layered on top of these manifests.

## What you need

- A running Kubernetes cluster (AKS, EKS, GKE, k3s, kind, OpenShift, etc.)
- `kubectl` connected to your cluster
- An API key for at least one model provider

## Quick start

```bash
# Replace with your provider: ANTHROPIC, GEMINI, OPENAI, or OPENROUTER
export <PROVIDER>_API_KEY="..."
./scripts/k8s/deploy.sh

kubectl port-forward svc/openclaw 18789:18789 -n openclaw
open http://localhost:18789
```

Retrieve the configured shared secret for the Control UI. This deploy script
creates token auth by default:

```bash
kubectl get secret openclaw-secrets -n openclaw -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 -d
```

For local debugging, `./scripts/k8s/deploy.sh --show-token` prints the token after deploy.

## Local testing with Kind

If you don't have a cluster, create one locally with [Kind](https://kind.sigs.k8s.io/):

```bash
./scripts/k8s/create-kind.sh           # auto-detects docker or podman
./scripts/k8s/create-kind.sh --delete  # tear down
```

Then deploy as usual with `./scripts/k8s/deploy.sh`.

## Step by step

### 1) Deploy

**Option A** — API key in environment (one step):

```bash
# Replace with your provider: ANTHROPIC, GEMINI, OPENAI, or OPENROUTER
export <PROVIDER>_API_KEY="..."
./scripts/k8s/deploy.sh
```

The script creates a Kubernetes Secret with the API key and an auto-generated gateway token, then deploys. If the Secret already exists, it preserves the current gateway token and any provider keys not being changed.

**Option B** — create the secret separately:

```bash
export <PROVIDER>_API_KEY="..."
./scripts/k8s/deploy.sh --create-secret
./scripts/k8s/deploy.sh
```

Use `--show-token` with either command if you want the token printed to stdout for local testing.

### 2) Access the gateway

```bash
kubectl port-forward svc/openclaw 18789:18789 -n openclaw
open http://localhost:18789
```

## What gets deployed

```
Namespace: openclaw (configurable via OPENCLAW_NAMESPACE)
├── Deployment/openclaw        # Single pod, init container + gateway
├── Service/openclaw           # ClusterIP on port 18789
├── PersistentVolumeClaim      # 10Gi for agent state and config
├── ConfigMap/openclaw-config  # openclaw.json + AGENTS.md
└── Secret/openclaw-secrets    # Gateway token + API keys
```

## What persists across updates

Re-running `./scripts/k8s/deploy.sh` is the normal update path. It preserves the cluster-side state you usually care about:

- `PersistentVolumeClaim/openclaw-home-pvc` stays mounted at `/home/node/.openclaw`, so runtime state under that tree survives redeploys.
- `Secret/openclaw-secrets` keeps the existing gateway token and any provider keys you are not actively replacing.
- The deploy script applies manifests in place, then restarts the `Deployment/openclaw` pod.

Important caveat: the init container copies `openclaw.json` and workspace `AGENTS.md` from `scripts/k8s/manifests/configmap.yaml` into the PVC on every pod start. Treat those two files as declarative config, not hand-edited in-cluster state:

- Edits to `/home/node/.openclaw/openclaw.json` inside the running pod are replaced on the next restart.
- Edits to `/home/node/.openclaw/workspace/AGENTS.md` inside the running pod are also replaced on the next restart.
- Other state in the PVC, such as sessions, credentials, and additional workspace files, remains intact unless you delete the namespace/PVC yourself.

## Fork specific k3s agent cluster

This fork also includes `scripts/k8s/openclaw-agent-cluster/k3s-up.sh`, which is different from the simpler Kustomize path above:

- It targets local `k3s`, `k3d`, or Docker Desktop Kubernetes.
- It builds and imports a local Docker image by default.
- It deploys a `StatefulSet/openclaw-gateway` in namespace `openclaw-agents`.
- It uses `PersistentVolumeClaim/openclaw-state` for `/home/node/.openclaw`.
- It mounts `openclaw.json` directly from a `ConfigMap` at `/etc/openclaw/openclaw.json` instead of copying it into the PVC.
- It seeds a collaborative multi-agent setup (`main`, `orchestrator`, `researcher`, `builder`, `reviewer`) instead of the single default agent from `scripts/k8s/manifests/configmap.yaml`.

That means the persistence and update behavior is different:

- PVC-backed state under `/home/node/.openclaw` survives rollout.
- The mounted config file updates immediately on restart because it is read from the `ConfigMap`, not copied into the PVC.
- Provider keys in `openclaw-secrets` are preserved if you do not overwrite them.
- The gateway token is **not** preserved automatically by `k3s-up.sh`. If `OPENCLAW_GATEWAY_TOKEN` is unset, the script generates a fresh token and patches the Secret, which can force clients to reconnect with the new token.

## Customization

### Agent instructions

Edit the `AGENTS.md` in `scripts/k8s/manifests/configmap.yaml` and redeploy:

```bash
./scripts/k8s/deploy.sh
```

### Gateway config

Edit `openclaw.json` in `scripts/k8s/manifests/configmap.yaml`. See [Gateway configuration](/gateway/configuration) for the full reference.

### Add providers

Re-run with additional keys exported:

```bash
export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."
./scripts/k8s/deploy.sh --create-secret
./scripts/k8s/deploy.sh
```

Existing provider keys stay in the Secret unless you overwrite them.

Or patch the Secret directly:

```bash
kubectl patch secret openclaw-secrets -n openclaw \
  -p '{"stringData":{"<PROVIDER>_API_KEY":"..."}}'
kubectl rollout restart deployment/openclaw -n openclaw
```

### Custom namespace

```bash
OPENCLAW_NAMESPACE=my-namespace ./scripts/k8s/deploy.sh
```

### Custom image

Edit the `image` field in `scripts/k8s/manifests/deployment.yaml`:

```yaml
image: ghcr.io/openclaw/openclaw:latest # or pin to a specific version from https://github.com/openclaw/openclaw/releases
```

### Expose beyond port-forward

The default manifests bind the gateway to loopback inside the pod. That works with `kubectl port-forward`, but it does not work with a Kubernetes `Service` or Ingress path that needs to reach the pod IP.

If you want to expose the gateway through an Ingress or load balancer:

- Change the gateway bind in `scripts/k8s/manifests/configmap.yaml` from `loopback` to a non-loopback bind that matches your deployment model
- Keep gateway auth enabled and use a proper TLS-terminated entrypoint
- Configure the Control UI for remote access using the supported web security model (for example HTTPS/Tailscale Serve and explicit allowed origins when needed)

## Update a live cluster

Use this flow when you want to update the deployment without wiping the existing PVC-backed state.

### Pick the right deploy path first

- For the simple single-gateway manifests in `scripts/k8s/manifests`, use `./scripts/k8s/deploy.sh`.
- For this fork's local collaborative cluster in `scripts/k8s/openclaw-agent-cluster`, use `./scripts/k8s/openclaw-agent-cluster/k3s-up.sh`.

The rest of this section calls out where those flows differ.

### 1) Make the desired manifest changes

Typical examples:

- New OpenClaw image version: edit `scripts/k8s/manifests/deployment.yaml`
- Gateway config or default `AGENTS.md`: edit `scripts/k8s/manifests/configmap.yaml`
- Provider credentials: re-run `./scripts/k8s/deploy.sh --create-secret` with new env vars, or patch the Secret directly

For the fork-specific `openclaw-agent-cluster` path, the equivalents are:

- New image: pass `--image <tag>` to `k3s-up.sh` after building/importing that image, or update the default image argument in your wrapper flow.
- New model: pass `--model <provider/model>`.
- New storage size: pass `--storage-size <size>` before first deploy; changing PVC size later depends on your cluster storage class.
- Config changes: edit the inline `ConfigMap` payload in `scripts/k8s/openclaw-agent-cluster/k3s-up.sh`.
- Provider credentials: export the desired `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `ZAI_API_KEY`, or `MINIMAX_API_KEY` before re-running.

If you are updating the container image, prefer an explicit version tag instead of the moving `:slim` tag:

```yaml
image: ghcr.io/openclaw/openclaw:2026.3.14
```

That keeps upgrades deterministic. With `imagePullPolicy: IfNotPresent`, restarting a pod on an unchanged moving tag can reuse a cached image.

For the fork-specific `openclaw-agent-cluster` path, the deployed `StatefulSet` uses `imagePullPolicy: Never`, so the important rule is different:

- Build a new local image tag.
- Import that tag into the cluster runtime.
- Re-run `k3s-up.sh --image <that-tag>`.

Do not rely on a reused local tag unless you are certain every node has the updated image.

### 1.5) Preserve the gateway token on the fork-specific path

This is the main live-cluster footgun for `scripts/k8s/openclaw-agent-cluster/k3s-up.sh`.

Before re-running it on an existing cluster, export the current token from the cluster Secret:

```bash
export OPENCLAW_GATEWAY_TOKEN="$(
  kubectl -n openclaw-agents get secret openclaw-secrets \
    -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 -d
)"
```

Then run the update command with that same token still in your environment.

If you skip this step, `k3s-up.sh` generates a new token and patches the Secret, which can invalidate existing client connections and make the update feel like you had to "refresh everything."

### 2) Re-apply the manifests

```bash
./scripts/k8s/deploy.sh
```

This applies the manifests and restarts the pod so config and secret changes take effect, while keeping the existing PVC and Secret in place.

Fork-specific local cluster example:

```bash
export OPENCLAW_GATEWAY_TOKEN="$(
  kubectl -n openclaw-agents get secret openclaw-secrets \
    -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 -d
)"

./scripts/k8s/openclaw-agent-cluster/k3s-up.sh \
  --image openclaw:agent-cluster-local \
  --model "openai/gpt-5.2"
```

That keeps the existing PVC-backed state and reuses the current token instead of rotating it.

### 3) Verify the update

```bash
kubectl rollout status deployment/openclaw -n openclaw --timeout=300s
kubectl get pods -n openclaw
kubectl get pvc openclaw-home-pvc -n openclaw
kubectl port-forward svc/openclaw 18789:18789 -n openclaw
```

Then confirm the Control UI and health endpoint still respond:

```bash
curl -fsS http://127.0.0.1:18789/healthz
```

Fork-specific local cluster checks:

```bash
kubectl -n openclaw-agents rollout status statefulset/openclaw-gateway --timeout=240s
kubectl -n openclaw-agents get pods
kubectl -n openclaw-agents get pvc openclaw-state
kubectl -n openclaw-agents port-forward svc/openclaw-gateway 18789:18789
curl -fsS http://127.0.0.1:18789/readyz
```

### What not to do

If you want to preserve data, avoid:

- `./scripts/k8s/deploy.sh --delete`
- Deleting the `openclaw-home-pvc` PVC
- Renaming the PVC without migrating the stored data
- Re-running `scripts/k8s/openclaw-agent-cluster/k3s-up.sh` without exporting the current `OPENCLAW_GATEWAY_TOKEN` first
- Recreating the `openclaw-agents` namespace unless you intentionally want a fresh cluster state

Also note that the included manifest uses `strategy: Recreate`, so updates preserve state but are not zero-downtime. Expect a brief restart while the pod is replaced.

If you run more than one Gateway instance behind a load balancer, also review [Cluster update and reload](/gateway/cluster-update-reload) for the rollout/device-token side of multi-instance updates.

## Re-deploy / restart

```bash
./scripts/k8s/deploy.sh
```

This applies all manifests and restarts the pod to pick up any config or secret changes.

## Teardown

```bash
./scripts/k8s/deploy.sh --delete
```

This deletes the namespace and all resources in it, including the PVC.

## Architecture notes

- The gateway binds to loopback inside the pod by default, so the included setup is for `kubectl port-forward`
- No cluster-scoped resources — everything lives in a single namespace
- Security: `readOnlyRootFilesystem`, `drop: ALL` capabilities, non-root user (UID 1000)
- The default config keeps the Control UI on the safer local-access path: loopback bind plus `kubectl port-forward` to `http://127.0.0.1:18789`
- If you move beyond localhost access, use the supported remote model: HTTPS/Tailscale plus the appropriate gateway bind and Control UI origin settings
- Secrets are generated in a temp directory and applied directly to the cluster — no secret material is written to the repo checkout

## File structure

```
scripts/k8s/
├── deploy.sh                   # Creates namespace + secret, deploys via kustomize
├── create-kind.sh              # Local Kind cluster (auto-detects docker/podman)
└── manifests/
    ├── kustomization.yaml      # Kustomize base
    ├── configmap.yaml          # openclaw.json + AGENTS.md
    ├── deployment.yaml         # Pod spec with security hardening
    ├── pvc.yaml                # 10Gi persistent storage
    └── service.yaml            # ClusterIP on 18789
```
