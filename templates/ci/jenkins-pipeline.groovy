// wicked-testing acceptance pipeline — declarative Jenkins.
//
// Emitted by /wicked-testing:ci-bootstrap. See docs/CI.md for the
// exit-code contract, secrets, retention defaults, and the PR-comment
// generator used by the notify-pr stage.
//
// wicked-testing:ci-bootstrap:managed
// Remove the marker comment above to keep local edits across re-runs.

pipeline {
  agent {
    docker {
      image 'node:20'
      // `-u root` avoids host UID mismatches when writing to the
      // mounted workspace; remove if your Jenkins agent enforces
      // rootless containers.
      args '-u root'
    }
  }

  options {
    timestamps()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '30'))
  }

  environment {
    // Configure `anthropic-api-key` as a Jenkins "Secret text" credential.
    ANTHROPIC_API_KEY    = credentials('anthropic-api-key')
    WICKED_TESTING_CI    = '1'
    WICKED_TESTING_SCENARIO = 'scenarios/examples/smoke.md'
  }

  stages {
    stage('Setup') {
      steps {
        sh '''
          set -eu
          if [ -z "${ANTHROPIC_API_KEY}" ]; then
            echo "ANTHROPIC_API_KEY credential not bound. See docs/CI.md."
            exit 3
          fi
          npx --yes wicked-testing install
        '''
      }
    }

    stage('Structural test') {
      steps {
        sh 'npm test'
      }
    }

    stage('Acceptance') {
      steps {
        sh '''
          set -eu
          mkdir -p .wicked-testing/logs
          if [ ! -f "${WICKED_TESTING_SCENARIO}" ]; then
            echo "Scenario ${WICKED_TESTING_SCENARIO} not found — skipping."
            exit 0
          fi
          set -o pipefail
          npx --yes wicked-testing acceptance "${WICKED_TESTING_SCENARIO}" --json \
            | tee .wicked-testing/logs/acceptance.json
        '''
      }
    }

    stage('Notify PR') {
      when {
        // Requires the "GitHub Branch Source" or equivalent plugin so
        // CHANGE_ID (the PR number) is populated on PR builds.
        expression { return env.CHANGE_ID != null }
      }
      steps {
        sh '''
          set -eu
          python3 scripts/ci/manifest-to-comment.py \
            --manifest-glob ".wicked-testing/evidence/*/manifest.json" \
            --log .wicked-testing/logs/acceptance.json \
            > .wicked-testing/logs/pr-comment.md \
          || echo "_(wicked-testing: no manifest produced for this run)_" > .wicked-testing/logs/pr-comment.md
        '''
        // Requires the `pipeline-github` or `ghprb` plugin; alternatively,
        // swap for `gh pr comment` if `gh` is available in the agent.
        script {
          def body = readFile('.wicked-testing/logs/pr-comment.md')
          try {
            pullRequest.comment(body)
          } catch (err) {
            echo "Could not post PR comment: ${err}"
          }
        }
      }
    }
  }

  post {
    always {
      // Evidence archival — 14-day retention via buildDiscarder above.
      archiveArtifacts(
        artifacts: '.wicked-testing/evidence/**/manifest.json,' +
                   '.wicked-testing/evidence/**/artifacts/**,' +
                   '.wicked-testing/logs/**',
        allowEmptyArchive: true,
        fingerprint: true
      )
    }
  }
}
