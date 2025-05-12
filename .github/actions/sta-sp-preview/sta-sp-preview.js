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

function removeExtension(path) {
  const lastSlash = path.lastIndexOf('/');
  const fileName = path.slice(lastSlash + 1);
  const dotIndex = fileName.lastIndexOf('.');

  if (dotIndex === -1) return path; // No extension
  return path.slice(0, lastSlash + 1) + fileName.slice(0, dotIndex);
}

/**
 * Operate (preview, publish, ...) on one path, relative to the endpoint:
 * (${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}/)
 * @param {string} endpoint
 * @param {string} path
 * @returns {Promise<*|boolean>}
 */
async function operateOnPath(endpoint, path) {
  const pathWithoutExt = removeExtension(path);
  try {
    const resp = await fetch(`${endpoint}${pathWithoutExt}`, {
      method: 'POST',
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Expose-Headers': 'x-error, x-error-code',
      },
    });
    if (!resp.ok) {
      core.warning(`Operation failed on ${path}: ${resp.headers.get('x-error')}`);
      return false;
    }

    const data = await resp.json();
    return data.preview.url;
  } catch (error) {
    core.warning(`Operation call failed on ${path}: ${error.message}`);
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
  const operationReport = {
    previews: 0,
    failures: 0,
    failureList: [],
  };

  try {
    const endpoint = `${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}`;

    for (const path of paths) {
      core.info(`Performing ${OP_LABEL[operation]} operation on path: ${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}${path}`);
      if (await operateOnPath(endpoint, path)) {
        operationReport.previews += 1;
      } else {
        operationReport.failures += 1;
        operationReport.failureList.push(path);
      }
    }

    core.setOutput('preview_successes', operationReport.previews);
    core.setOutput('preview_failures', operationReport.failures);
    core.setOutput('preview_failure_list', operationReport.failureList.join(','));
  } catch (error) {
    core.warning(`❌ Preview Error: ${error.message}`);
    core.setOutput('error_message', '❌ Error: Failed to preview all of paths.');
  }
}

await run();
