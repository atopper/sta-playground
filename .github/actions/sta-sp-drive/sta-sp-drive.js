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

async function findFolderId(token, siteId, fullPath) {
  const parts = fullPath.split('/').filter(Boolean);
  let currentPath = '';
  let folderData = null;

  for (const part of parts) {
    const endpoint = `/sites/${siteId}/drive/root:${currentPath}/${part}`;
    try {
      const nextAttempt = await graphFetch(token, endpoint);

      // Sanity check: make sure it's a folder
      if (!folderData.folder) {
        core.warning(`"${part}" exists but is not a folder. Skipping...`);
      } else {
        core.info(`Found folder "${part}" with path "${nextAttempt.parentReference.path}"`);
        folderData = nextAttempt.value[0] || folderData;
        currentPath += `/${nextAttempt.parentReference.path}`;
      }
    } catch (e) {
      core.info(`Could not find a drive id for "${part}". Trying the next one...`);
    }
  }

  if (!folderData) {
    throw new Error(`❌ Final folder not found for path "${fullPath}".`);
  }

  // console.log(`✅ Found folder "${folderData.name}"`);
  // console.log(`📁 Folder ID: ${folderData.id}`);
  // console.log(`📂 Drive ID: ${folderData.parentReference?.driveId}`);

  return {
    folderId: folderData.id,
    driveId: folderData.parentReference?.driveId,
  };
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
    core.warning(`Failed to get Site Id: ${error1.message}`);
  }

  // Now find the drive id.  The folder path may represent a drive link, and not the actual path
  // so some effort is needed to find the drive id.
  if (siteId) {
    try {
      // Step 2: Assume folder path is actually a folder path.
      const folder = await graphFetch(token, `/sites/${siteId}/drive/root:${decodedFolderPath}`);
      core.info(`✅ Drive ID: ${folder.parentReference.driveId}`);
      core.info(`✅ Folder ID: ${folder.id}`);
      core.setOutput('drive_id', folder.parentReference.driveId);
      core.setOutput('folder_id', folder.id);
    } catch (error2) {
      core.info(`Failed to get folder info for ${siteId} / ${decodedFolderPath}: ${error2.message}. Trying to find it...`);

      // Folder path is a link, so try to find the drive id that it represents.
      try {
        const { folderId, driveId } = await findFolderId(token, siteId, decodedFolderPath);
        // let currentFolder = '';
        // let targetFolder = '';
        // const folderNames = decodedFolderPath.split('/');
        // for (const folderName of folderNames) {
        //   core.info(`Searching for folder: ${folderName}`);
        //   const hits = await graphFetch(token, `/sites/${siteId}/drive/root/search
        //   (q='${folderName}')`);
        //   const folders = hits.value.filter((item) => item.folder);
        //   for (const item of folders) {
        //     core.info(`Found: ${item.name}`);
        //     core.info(`Path: ${item.parentReference.path}`);
        //     core.info(`Drive ID: ${item.parentReference.driveId}`);
        //     core.info(`Item ID: ${item.id}`);
        //   }
        //   if (folders.length === 1) {
        //     targetFolder = `/${folders[0].path}`;
        //     currentFolder += `/${folders[0].path}`;
        //   }
        // }
        // if (targetFolder) {
        //   const path = `${targetFolder.parentReference.path}/${targetFolder.name}`;
        //   const cleanPath = path.replace('/drive/root:', '');
        //   core.info(`✅ Clean Path: ${cleanPath}`);
        //
        //   // Step 2: Get the folder path
        //   const folder = await graphFetch(token, `/sites/${siteId}/drive/root:/${cleanPath}`);
        //   core.info(`✅ Drive ID: ${folder.parentReference.driveId}`);
        //   core.info(`✅ Folder ID: ${folder.id}`);
        //   core.setOutput('drive_id', folder.parentReference.driveId);
        //   core.setOutput('folder_id', folder.id);
        // }
        core.info(`✅ Drive ID: ${driveId}`);
        core.info(`✅ Folder ID: ${folderId}`);
        core.setOutput('drive_id', driveId);
        core.setOutput('folder_id', folderId);
      } catch (error3) {
        core.warning(`Failed to get folder info for ${siteId}: ${error3.message}`);
      }
    }
  }
}

await run();
