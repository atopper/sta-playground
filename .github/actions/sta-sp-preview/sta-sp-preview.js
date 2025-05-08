/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import core from '@actions/core';

const HLX_ADM_API = 'https://admin.hlx.page';
let jobStatusPoll;
let jobStatusFailures = 0;
const previewReport = {
  previews: 0,
  failures: 0,
};
const OP_LABEL = {
  preview: 'preview',
  live: 'publish',
};

async function pollJob({
  name,
  operation,
  owner,
  repo,
  branch,
  resolve,
  reject,
}) {
  try {
    const endpoint = `https://admin.hlx.page/job/${owner}/${repo}/${branch}/${operation}/${name}/details`;
    const jobResp = await fetch(endpoint);
    const jobStatus = await jobResp.json();
    const {
      state,
      progress: {
        total = 0,
        processed = 0,
        failed = 0,
      } = {},
      startTime,
      stopTime,
      data: {
        resources = [],
      } = {},
    } = jobStatus;

    if (state === 'stopped') {
      // job done, stop polling
      clearInterval(jobStatusPoll);
      jobStatusPoll = undefined;
      // show job summary
      resources.forEach((res) => core.debug(`${res.path} (${res.status})`));
      const duration = (new Date(stopTime).valueOf()
        - new Date(startTime).valueOf()) / 1000;
      core.info(`Bulk ${OP_LABEL[operation]} completed in ${duration}s, ${processed} urls previewed, out of ${total}.`);
      previewReport.previews = processed;
      previewReport.failures = failed;

      resolve();
    } else {
      // show job progress
      core.info(`Bulk ${OP_LABEL[operation]}ed ${processed} urls.`);
    }
  } catch (error) {
    core.warning(`Failed to get status for job ${name}: ${error}`);
    jobStatusFailures += 1;
    if (jobStatusFailures > 6) {
      reject(new Error(`Failed to get status for job ${name} after 6 attempts. Completion cannot be guaranteed. Please verify yourself.`));
    }
  }
}

/**
 * Get the site and drive ID for a SharePoint site.
 * @returns {Promise<void>}
 */
export async function run() {
  const context = core.getInput('context');
  const urlsInput = core.getInput('urls');
  const forceInput = core.getInput('force');
  const operationInput = core.getInput('operation') || 'preview';
  const paths = urlsInput.split(',').map((url) => url.trim());
  const forceUpdate = forceInput === 'true';
  const operation = operationInput === 'publish' ? 'live' : operationInput;

  const { project } = JSON.parse(context);
  const { owner, repo, branch = 'main' } = project;

  core.info(`${OP_LABEL[operation]}ing content for ${paths.length} urls using ${owner} : ${repo} : ${branch}${forceUpdate ? 'with force' : ''}.`);

  try {
    const endpoint = `${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}/*`;
    const bulkResp = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        paths,
        forceUpdate,
      }),
      headers: {
        'content-type': 'application/json',
      },
    });
    if (!bulkResp.ok) {
      throw new Error(`Failed to bulk ${OP_LABEL[operation]} ${paths.length} URLs on ${owner}/${repo}: ${await bulkResp.text()}`);
    }

    const { job } = await bulkResp.json();
    const { name } = job;
    const options = {
      name,
      operation,
      owner,
      repo,
      branch,
    };

    // Create a Promise to wait for job completion, and to poll for its progress.
    await new Promise((resolve, reject) => {
      options.resolve = resolve;
      options.reject = reject;
      jobStatusPoll = setInterval(async () => pollJob(options), 4000);
    });

    core.setOutput('preview_successes', previewReport.previews);
    core.setOutput('preview_failures', previewReport.failures);
  } catch (error) {
    core.warning(`❌ Preview Error: ${error.message}`);
    core.setOutput('error_message', '❌ Error: Failed to preview all the content.');
  } finally {
    if (jobStatusPoll) {
      clearInterval(jobStatusPoll);
    }
  }
}

await run();
