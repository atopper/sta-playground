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
 * Simple function to remove a path's final extension, if it exists.
 * @param {string} path
 * @returns {string}
 */
function removeExtension(path) {
  const lastSlash = path.lastIndexOf('/');
  const fileName = path.slice(lastSlash + 1);
  const dotIndex = fileName.lastIndexOf('.');

  if (dotIndex === -1) return path; // No extension
  return path.slice(0, lastSlash + 1) + fileName.slice(0, dotIndex);
}

/**
 * Operate (preview, publish (live), ...) on one path, relative to the endpoint:
 * (${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}/)
 * @param {string} endpoint
 * @param {string} path
 * @param {string} operation 'preview' or 'live'
 * @returns {Promise<*|boolean>}
 */
async function operateOnPath(endpoint, path, operation = 'preview') {
  try {
    const resp = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Expose-Headers': 'x-error, x-error-code',
      },
    });
    if (!resp.ok) {
      // Check for unsupported media type, and try without an extension
      if (resp.status === 415) {
        const noExtPath = removeExtension(path);
        // Avoid infinite loop by ensuring the path changed.
        if (noExtPath !== path) {
          core.info(`> Failed with an "Unsupported Media" error. Retrying operation without an extension: ${noExtPath}`);
          return operateOnPath(endpoint, removeExtension(noExtPath), operation);
        }
        core.warning(`Operation failed on ${path}: ${resp.headers.get('x-error')}`);
      } else if (resp.status === 423) {
        core.warning(`Operation failed on ${path}. The file appears locked. Is it being edited? (${resp.headers.get('x-error')})`);
      } else {
        core.warning(`Operation failed on ${path}: ${resp.headers.get('x-error')}`);
      }
      return false;
    }

    const data = await resp.json();
    core.info(`Operation successful on ${path}: ${data[operation].url}`);
    return true;
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

  const operationLabel = OP_LABEL[operation];
  if (!operationLabel) {
    core.setOutput('error_message', `Invalid operation: ${operationInput}. Supported operations are 'preview' and 'publish'.`);
    return;
  }

  const { project } = JSON.parse(context);
  const { owner, repo, branch = 'main' } = project;
  const operationReport = {
    successes: 0,
    failures: 0,
    failureList: [],
  };

  core.info(`Performing ${operationLabel} for ${paths.length} urls using ${owner} : ${repo} : ${branch}.`);
  core.debug(`URLs: ${urlsInput}`);

  try {
    const endpoint = `${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}`;

    for (const path of paths) {
      core.debug(`Performing operationLabel operation on path: ${HLX_ADM_API}/${operation}/${owner}/${repo}/${branch}${path}`);
      if (await operateOnPath(endpoint, path, operation)) {
        operationReport.successes += 1;
      } else {
        operationReport.failures += 1;
        operationReport.failureList.push(path);
      }
    }

    core.setOutput('successes', operationReport.successes);
    core.setOutput('failures', operationReport.failures);
    core.setOutput('failure_list', operationReport.failureList.join(','));
    if (operationReport.failures > 0) {
      core.setOutput('error_message', `❌ Error: Failed to ${operationLabel} ${operationReport.failures} of ${paths.length} paths.`);
    }
  } catch (error) {
    core.warning(`❌ Error: ${error.message}`);
    core.setOutput('error_message', `❌ Error: Failed to ${operationLabel} all of paths.`);
  }
}

await run();
