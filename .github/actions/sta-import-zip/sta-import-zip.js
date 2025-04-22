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
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import unzipper from 'unzipper';

/**
 * Create a temporary directory, with a 'contents' directory in it.
 * @returns {string} The path to the temporary directory.
 */
function createTempDirectory() {
  const tempDirPrefix = path.join(os.tmpdir(), 'sta-');
  const tempDir = fs.mkdtempSync(tempDirPrefix);

  const contentsDir = path.join(tempDir, 'contents');
  fs.mkdirSync(contentsDir, { recursive: true });

  core.info(`✅ Import Zip Directory: ${tempDir}. Contents: ${contentsDir}`);

  return tempDir;
}

/**
 * Fetch a zip file from a URL and save it to a specified directory.
 * @param {string} downloadUrl - The URL of the zip file to download.
 * @param {string} saveDir - The directory where the zip file will be saved.
 * @returns {Promise<string>} - The path to the saved zip file.
 */
async function fetchAndExtractZip(downloadUrl, saveDir) {
  const contentsDir = path.join(saveDir, 'contents');

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download zip. Did the url expire? ${response.status} ${response.statusText}`);
  }

  // Convert web stream to Node stream
  const nodeStream = Readable.fromWeb(response.body);

  try {
    // Pipe and await stream completion using `finished` from 'stream/promises'
    const unzipStream = nodeStream.pipe(unzipper.Extract({ path: contentsDir }));

    // Add error handling for the unzip stream directly
    unzipStream.on('error', (err) => {
      throw new Error(err);
    });

    await finished(unzipStream);
  } catch (error) {
    throw new Error(`Failed to extract zip: ${error.message || error}`);
  }

  core.info('Downloaded and extracted Import zip contents to a temp directory.');
}

/**
 * Create a temporary directory, download the Import zip to it and
 * extract it to a 'contents' folder in the temp directory.
 * @returns {Promise<void>}
 */
export async function run() {
  try {
    const downloadUrl = core.getInput('download_url');
    if (!downloadUrl.includes('spacecat')) {
      throw new Error(`Invalid download url: ${downloadUrl}`);
    }
    // eslint-disable-next-line no-new
    new URL(downloadUrl);

    const tempDir = createTempDirectory();
    await fetchAndExtractZip(downloadUrl, tempDir);

    core.setOutput('temp_dir', tempDir);
  } catch (error) {
    core.warning(`❌ Error: ${error.message}`);
    core.setOutput('error_message', `❌ Error: ${error.message}`);
  }
}

await run();
