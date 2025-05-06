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
 * Find the drive id of the drive provided, and find the folder within it.
 * @param token
 * @param siteId
 * @param drive
 * @param folderPath
 * @returns {Promise<{driveId, folderId}|undefined>}
 */
async function searchByDrive(token, siteId, drive, folderPath) {
  let driveData;
  try {
    driveData = await graphFetch(token, `/sites/${siteId}/drives?search=${drive}`);

    if (!driveData) {
      core.warning(`Drive "${drive}" not found in site.`);
    } else if (driveData.value.length !== 1) {
      core.warning(`Multiple drives with name "${drive}" found in site.`);
      for (const drv of driveData.value) {
        core.info(`Drive ID: ${drv.id}, Name: ${drv.name}`);
      }
    } else {
      const driveId = driveData.value[0].id;
      core.info(`Drive "${drive}" found in site with id ${driveId}.`);
      try {
        const folder = await graphFetch(token, `/drives/${driveId}/root:/${folderPath}`);
        return {
          folderId: folder.id,
          driveId,
        };
      } catch (e) {
        core.warning(`Could not find path "${folderPath}" in drive id ${driveId}.`);
      }
    }
  } catch (e) {
    core.warning(`Could not find drive id of "${drive}".`);
  }

  return undefined;
}

/**
 * Search for a folder with the provided name.
 * @param token
 * @param siteId
 * @param folderPath
 * @returns {Promise<undefined|{driveId: *, folderId}>}
 */
async function searchFolderByName(token, siteId, folderPath) {
  const folderName = folderPath.split('/').pop();
  const endpoint = `/sites/${siteId}/drive/root/search(q='${folderName}')`;
  const searchResults = await graphFetch(token, endpoint);
  if (!searchResults.value || searchResults.value.length === 0) {
    core.warning(`Folder "${folderName}" not found.`);
    return undefined;
  }

  // Filter results to ensure it's a folder
  const folder = searchResults.value.filter((item) => item.folder);
  if (!folder || folder.length === 0) {
    core.warning(`No folder found with the name "${folderName}".`);
    return undefined;
  }
  if (folder.length > 1) {
    core.warning(`Multiple folders found with the name "${folderName}".`);
    return undefined;
  }
  return {
    folderId: folder[0].id,
    driveId: folder[0].parentReference.driveId,
  };
}

/**
 * Use all the techniques to find the drive and folder id.
 * @param token
 * @param siteId
 * @param folderName
 * @returns {Promise<undefined|{driveId: *, folderId: *}>}
 */
async function findDriveAndFolderId(token, siteId, folderName) {
  // Find folder within a drive, if there is one provided.
  const parts = folderName.split('/sites/');
  if (parts.length === 2) {
    const drive = parts[0];
    const path = parts[1];
    const byDriveId = await searchByDrive(token, siteId, drive, path);
    if (byDriveId) {
      return byDriveId;
    }
  }

  // Find by folder name, in any drive.
  const byFolderName = await searchFolderByName(token, siteId, folderName);
  if (byFolderName) {
    return byFolderName;
  }

  return undefined;
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
    core.setOutput('error_message', `❌ Error: Failed to get Site Id: ${error1.message}`);
    return;
  }

  // Now find the drive id.  The folder path may represent a drive link, and not the actual path
  // so some effort is needed to find the drive id.
  let folder;
  if (siteId) {
    try {
      // Step 2: Assume folder path is actually the folder path.
      folder = await graphFetch(token, `/sites/${siteId}/drive/root:${decodedFolderPath}`);
    } catch (error2) {
      core.info(`Did not find folder info for ${siteId} / ${decodedFolderPath}: ${error2.message}. Trying to find it by digging in a little...`);

      // Folder path is a link, so try to find the drive id that it represents.
      try {
        folder = await findDriveAndFolderId(token, siteId, decodedFolderPath);
      } catch (error3) {
        core.warning(`Failed to get folder info for ${siteId}: ${error3.message}`);
      }
    }

    if (folder) {
      core.info(`✅ Drive ID: ${folder.parentReference.driveId}`);
      core.info(`✅ Folder ID: ${folder.id}`);
      core.setOutput('drive_id', folder.parentReference.driveId);
      core.setOutput('folder_id', folder.id);
    } else {
      core.setOutput('error_message', '❌ Error: Failed to get drive and/or folder Id.');
    }
  }
}

await run();
