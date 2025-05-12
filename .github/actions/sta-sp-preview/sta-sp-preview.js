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
const OP_LABEL = {
  preview: 'preview',
  live: 'publish',
};

/**
 * Preview one path, relative to the endpoint:
 * (${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}/)
 * @param {string} endpoint
 * @param {string} path
 * @returns {Promise<*|boolean>}
 */
async function previewPath(endpoint, path) {
  try {
    const resp = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Expose-Headers': 'x-error, x-error-code',
      },
    });
    if (!resp.ok) {
      core.warning(`Failed to preview ${path}: ${resp.headers.get('x-error')}`);
      return false;
    }

    const data = await resp.json();
    return data.preview.url;
  } catch (error) {
    core.warning(`Failed to preview ${path}: ${error.message}`);
  }

  return false;
}

/**
 * Get the site and drive ID for a SharePoint site.
 * @returns {Promise<void>}
 */
export async function run() {
  const context = core.getInput('context');
  const urlsInput = core.getInput('urls');
  const operationInput = core.getInput('operation') || 'preview';
  const paths = urlsInput.split(',').map((url) => url.trim());
  const operation = operationInput === 'publish' ? 'live' : operationInput;

  const { project } = JSON.parse(context);
  const { owner, repo, branch = 'main' } = project;

  core.info(`${OP_LABEL[operation]}ing content for ${paths.length} urls using ${owner} : ${repo} : ${branch}.`);
  core.info(`URLs: ${urlsInput}`);
  const previewReport = {
    previews: 0,
    failures: 0,
    failureList: [],
  };

  try {
    const endpoint = `${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}`;

    for (const path of paths) {
      core.info(`Preview ${OP_LABEL[operation]} path: ${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}${path}`);
      if (await previewPath(endpoint, path)) {
        previewReport.previews += 1;
      } else {
        previewReport.failures += 1;
        previewReport.failureList.push(path);
      }
    }

    core.setOutput('preview_successes', previewReport.previews);
    core.setOutput('preview_failures', previewReport.failures);
    core.setOutput('preview_failure_list', previewReport.failureList.join(','));
  } catch (error) {
    core.warning(`❌ Preview Error: ${error.message}`);
    core.setOutput('error_message', '❌ Error: Failed to preview all of paths.');
  }
}

await run();
