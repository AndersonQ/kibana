#!/usr/bin/env bash

set -euo pipefail

source .buildkite/scripts/steps/functional/common.sh

.buildkite/scripts/bootstrap.sh
.buildkite/scripts/copy_es_snapshot_cache.sh
node scripts/build_kibana_platform_plugins.js

export JOB=kibana-defend-workflows-serverless-cypress

buildkite-agent meta-data set "${BUILDKITE_JOB_ID}_is_test_execution_step" 'false'

echo "--- Defend Workflows Cypress tests, burning changed specs (Chrome)"

yarn --cwd x-pack/plugins/security_solution cypress:dw:serverless:changed-specs-only
