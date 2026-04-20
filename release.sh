#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
usage: ./release.sh <version>

Example:
  ./release.sh 1.3.0
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

VERSION="$1"
TAG="v$VERSION"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "error: version must look like 1.3.0 or 1.3.0-beta.1"
  exit 1
fi

cd "$ROOT_DIR"

if [[ ! -f package.json ]]; then
  echo "error: package.json not found in $ROOT_DIR"
  exit 1
fi

if [[ ! -f .signing/release.env ]]; then
  echo "error: .signing/release.env not found"
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "error: release must run from main (current: $CURRENT_BRANCH)"
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  echo "error: git worktree is not clean"
  git status --short
  exit 1
fi

CURRENT_VERSION="$(node -p "require('./package.json').version")"
if [[ "$CURRENT_VERSION" == "$VERSION" ]]; then
  echo "error: package.json is already at version $VERSION"
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: git tag $TAG already exists locally"
  exit 1
fi

if git ls-remote --tags origin "refs/tags/$TAG" | grep -q "$TAG"; then
  echo "error: git tag $TAG already exists on origin"
  exit 1
fi

echo "==> Bumping version: $CURRENT_VERSION -> $VERSION"
npm version "$VERSION" --no-git-tag-version

echo "==> Validating node typecheck"
npm run typecheck:node

echo "==> Creating release commit"
git add package.json package-lock.json
git commit -m "Release $TAG"

echo "==> Creating git tag"
git tag -a "$TAG" -m "Release $TAG"

echo "==> Pushing commit and tag"
git push origin main
git push origin "$TAG"

echo "==> Building, signing, notarizing, and publishing"
npm run release

echo
echo "Release complete:"
echo "  tag: $TAG"
