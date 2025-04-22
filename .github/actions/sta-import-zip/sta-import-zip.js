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
import { finished, pipeline } from 'stream/promises';
import unzipper from 'unzipper';

const CONTENT_DIR_NAME = 'contents';
const ZIP_NAME = 'import.zip';

/**
 * Create a temporary directory, with a 'contents' directory in it.
 * @returns {string} The path to the temporary directory.
 */
function createTempDirectory() {
  const tempDirPrefix = path.join(os.tmpdir(), 'sta-');
  const tempDir = fs.mkdtempSync(tempDirPrefix);

  const contentsDir = path.join(tempDir, CONTENT_DIR_NAME);
  fs.mkdirSync(contentsDir, { recursive: true });

  core.info(`✅ Import Zip Directory: ${tempDir}. Contents: ${contentsDir}`);

  return tempDir;
}

/**
 * Fetch a zip file from a URL and save it to a specified directory.
 * @param {string} downloadUrl - The URL of the zip file to download.
 * @param {string} zipDestination - The full file path where the zip file will be saved.
 * @returns {Promise<string>} - The path to the saved zip file.
 */
async function fetchZip(downloadUrl, zipDestination) {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download zip. Did the url expire? ${response.status} ${response.statusText}`);
  }

  try {
    const fileStream = fs.createWriteStream(zipDestination);
    const nodeStream = Readable.fromWeb(response.body);

    await pipeline(nodeStream, fileStream);

    // Validate zip file
    const directory = await unzipper.Open.file(zipDestination);

    core.info(`✅ Downloaded Import zip to ${zipDestination} with ${directory.files.length} files.`);
  } catch (error) {
    throw new Error(`Failed to download zip: ${error.message || error}`);
  }
}

async function extractContents(tempDir, contentsDir) {
  const zipDestination = path.join(tempDir, ZIP_NAME);

  try {
    const zipStream = fs.createReadStream(zipDestination).pipe(
      unzipper.Extract({ path: contentsDir }),
    );

    zipStream.on('error', (err) => {
      core.error('Unzip Stream emitted error:', err.message || err);
    });

    await finished(zipStream);
  } catch (error) {
    throw new Error(`Failed to extract zip: ${error.message || error}`);
  }

  core.info(`✅ Import zip extracted to: ${contentsDir}`);
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
    const zipDestination = path.join(tempDir, ZIP_NAME);
    const contentsDir = path.join(tempDir, CONTENT_DIR_NAME);
    await fetchZip(downloadUrl, zipDestination);
    await extractContents(tempDir, contentsDir);

    core.setOutput('contents_dir', contentsDir);
  } catch (error) {
    core.warning(`❌ Error: ${error.message}`);
    core.setOutput('error_message', `❌ Error: ${error.message}`);
  }
}

await run();
