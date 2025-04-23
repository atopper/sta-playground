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
import { spawn } from 'child_process';
import forge from 'node-forge';
import path from 'path';

async function runUpload(
  xwalkZipPath,
  assetMappingPath,
  target,
  token,
  skipAssets = false,
) {
  return new Promise((resolve, reject) => {
    const args = [
      '@adobe/aem-import-helper',
      'aem',
      'upload',
      '--zip', xwalkZipPath,
      '--asset-mapping', assetMappingPath,
      '--target', target,
      '--token', token,
    ];
    if (skipAssets) {
      args.push('--skip-assets');
    }

    const maskedArgs = args.map((arg) => (arg === token ? '***' : arg));
    core.info(`Running command: npx ${maskedArgs.join(' ')}`);

    const child = spawn('npx', args, {
      stdio: 'inherit', // Inherits stdout/stderr so you can see output in logs
      shell: true, // Required for `npx` to work correctly in some environments
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`aem-import-helper failed with exit code ${code}`));
      }
    });
  });
}

/**
 * Upload the import content for XWalk.
 * @returns {Promise<void>}
 */
export async function run() {
  const token64 = core.getInput('upload_token');
  const target = core.getInput('root_mountpoint');
  const zipPath = core.getInput('zip_path');
  const zipName = core.getInput('zip_name');
  const skipAssets = core.getInput('skip_assets');

  try {
    const token = forge.util.decode64(token64);

    const fullZipPath = path.join(zipPath, zipName || 'xwalk-index.zip');

    await runUpload(
      `${zipPath}/xwalk-index.zip`,
      fullZipPath,
      `${zipPath}/asset-mapping.json`,
      target,
      token,
      skipAssets === 'true',
    );
    core.info('✅ Upload completed successfully.');
  } catch (error) {
    core.warning(`Error: Failed to upload for XWalk to ${target}: ${error.message}`);
    core.setOutput('error_message', `Error: Failed to upload for XWalk to ${target}: ${error.message}`);
  }
}

await run();
