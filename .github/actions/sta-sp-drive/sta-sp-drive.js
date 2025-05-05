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
  core.info(`Fetching Graph API endpoint: https://graph.microsoft.com/v1.0${endpoint}`);
  const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    core.warning(`Graph API error ${res.status}: ${errorText}`);
    throw new Error(`Graph API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Get the site and drive ID for a SharePoint site.
 * @returns {Promise<void>}
 */
export async function run() {
  const token = core.getInput('token');
  const spHost = core.getInput('sp_host'); // i.e. adobe.sharepoint.com
  const spSitePath = core.getInput('sp_site_path'); // i.e. AEMDemos
  const spFolderPath = core.getInput('sp_folder_path'); // i.e. Shared%20Documents/sites/my-site/...
  const decodedFolderPath = decodeURIComponent(spFolderPath); // decode the spaces, etc.

  core.info(`Getting data for "${spHost} : ${spSitePath} : ${decodedFolderPath}".`);

  let siteId;
  try {
    // Step 1: Get Site ID
    const site = await graphFetch(token, `/sites/${spHost}:/sites/${spSitePath}`);
    siteId = site.id;
    core.info(`✅ Site ID: ${siteId}`);
  } catch (error1) {
    core.warning(`Failed get Site Id: ${error1.message}`);
  }

  if (siteId) {
    const searchQuery = encodeURIComponent('name:"andrew-top"');
    const results = await graphFetch(token, `/sites/${siteId}/drive/root/search(q=${searchQuery})`);
    const targetFolders = results.value.filter((item) => item.folder);
    for (const item of targetFolders) {
      core.info(`Found: ${item.name}`);
      core.info(`Path: ${item.parentReference.path}`);
      core.info(`Drive ID: ${item.parentReference.driveId}`);
      core.info(`Item ID: ${item.id}`);
    }
    if (targetFolders.length === 1) {
      try {
        const targetFolder = targetFolders[0];
        const path = `${targetFolder.parentReference.path}/${targetFolder.name}`; // Full path from root
        const cleanPath = path.replace('/drive/root:', '');
        core.info(`✅ Clean Path: ${cleanPath}`);

        // Step 2: Get the folder path
        const folder = await graphFetch(token, `/sites/${siteId}/drive/root:/${cleanPath}`);
        core.info(`✅ Drive ID: ${folder.parentReference.driveId}`);
        core.info(`✅ Folder ID: ${folder.id}`);
        core.setOutput('drive_id', folder.parentReference.driveId);
        core.setOutput('folder_id', folder.id);
      } catch (error2) {
        core.warning(`Failed get folder info for ${siteId}: ${error2.message}`);
      }
    }
  }
}

await run();
