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

async function graphFetch(token, endpoint) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Graph API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Get the site and drive Id
 * @returns {Promise<void>}
 */
export async function run() {
  const token = core.getInput('token');
  const spHost = core.getInput('sp_host');
  const spSitePath = core.getInput('sp_site_path');
  const spFolderPath = core.getInput('sp_folder_path');

  core.info(`Getting data for "${spHost} / ${spSitePath} / ${spFolderPath}".`);

  try {
    // Step 1: Get Site ID
    const site = await graphFetch(token, `/sites/${spHost}:${spSitePath}`);
    core.info(`✅ Site ID: ${site.id}`);

    // Step 2: Get the folder path
    const folder = await graphFetch(`/sites/${site.id}/drive/root:/${spFolderPath}`);
    core.info(`✅ Drive ID: ${folder.parentReference.driveId}`);
    core.info(`✅ Folder ID: ${folder.id}`);
    core.setOutput('drive_id', folder.parentReference.driveId);
  } catch (error) {
    core.warning(`Failed to send status: ${error.message}`);
  }
}

await run();
