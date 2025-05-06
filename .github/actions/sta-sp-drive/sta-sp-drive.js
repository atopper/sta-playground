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
 * @param siteId Id for the host and site (i.e. adobe.sharepoint.com / AEMDemos)
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
      for (const [index, drv] of driveData.value.entries()) {
        core.info(`Index: ${index + 1}, Drive ID: ${drv.id}, Name: ${drv.name}`);
      }
    } else {
      const driveId = driveData.value[0].id;
      core.info(`Drive "${drive}" (${driveId}) found in site with id ${siteId}.`);
      try {
        const parts = folderPath.split('/');
        const root = parts.shift();
        let folder = await graphFetch(token, `/drives/${driveId}/root:/${root}`);
        for (const sub of parts) {
          core.info(`Searching for subfolder "${sub}" in folder "${folder.name} / ${folder.id}".`);
          const children = await graphFetch(
            token,
            `/drives/${driveId}/items/${folder.id}/children`,
          );
          folder = children.value.find((item) => item.name === sub);
          core.info(`Found subfolder "${sub}" with id ${folder.id}".`);
        }

        return {
          folderId: folder.id,
          driveId,
        };
      } catch (e) {
        core.warning(`Could not find path "${folderPath}" in drive id ${driveId}: ${e.message}`);
      }
    }
  } catch (e) {
    core.warning(`Could not find drive id of "${drive}": ${e.message}`);
  }

  return undefined;
}

/**
 * Search for a folder with the provided name in the whole site.
 * @param token
 * @param siteId Id for the host and site (i.e. adobe.sharepoint.com / AEMDemos)
 * @param folderPath
 * @returns {Promise<undefined|{driveId: *, folderId}>}
 */
async function fetchFolderByPath(token, siteId, folderPath) {
  const folderName = folderPath.split('/').pop();
  const endpoint = `/sites/${siteId}/drive/root:/${folderName}`;
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
 * @param siteId Id for the host and site (i.e. adobe.sharepoint.com / AEMDemos)
 * @param folderPath
 * @returns {Promise<undefined|{driveId: *, folderId: *}>}
 */
async function findDriveAndFolderId(token, siteId, folderPath) {
  // Find by folder name, in any drive.
  const byFolderName = await fetchFolderByPath(token, siteId, folderPath);
  if (byFolderName) {
    return byFolderName;
  }

  // Find folder within a drive, if there is one provided.
  const byDriveId = await searchByDrive(token, siteId, folderPath);
  if (byDriveId) {
    return byDriveId;
  }

  return undefined;
}

async function getFolderByPath(token, driveId, folderPath) {
  const segments = folderPath.split('/'); // break the path into parts
  if (segments[0] === 'Documents' || segments[0] === 'Shared%20Documents') {
    segments.shift();
  }
  let currentId = 'root'; // start at root
  let currentPath = '';

  for (const segment of segments) {
    currentPath += `/${segment}`;
    try {
      const url = `/drives/${driveId}/root:${currentPath}`;
      const result = await graphFetch(token, url);
      currentId = result.id;
      core.info(`✔️ Found: ${currentPath} (id: ${currentId})`);
    } catch (err) {
      core.warning(`Segment not found: ${currentPath}`);
      return null;
    }
  }

  return {
    folderId: currentId,
    fullPath: currentPath,
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
    core.info(`✔️ Site ID: ${siteId}`);
  } catch (siteError) {
    core.warning(`Failed to get Site Id: ${siteError.message}`);
    core.setOutput('error_message', `❌ Error: Failed to get Site Id: ${siteError.message}`);
    return;
  }

  // Now find the (root) drive id.
  const rootDrive = decodedFolderPath.split('/').shift();
  let driveId;
  try {
    const driveResponse = await graphFetch(token, `/sites/${siteId}/drives`);
    core.info(`✔️ Found ${driveResponse.value.length} drives in site ${siteId}.`);
    const sharedDocumentsDrive = driveResponse.value.find((dr) => dr.name === rootDrive);
    if (sharedDocumentsDrive) {
      driveId = sharedDocumentsDrive.id;
      core.info(`✔️ Found ${rootDrive} with a drive Id of ${driveId}`);
    }
    if (!driveId && driveResponse?.value.length === 1 && driveResponse.value[0].name === 'Documents') {
      driveId = driveResponse.value[0].id;
      core.info(`✔️ Found default drive 'Documents' with a drive Id of ${driveId}`);
    }
  } catch (driveError) {
    core.warning(`Failed to get Drive Id: ${driveError.message}`);
    core.setOutput('error_message', `❌ Error: Failed to get Site Id: ${driveError.message}`);
    return;
  }

  // Now get the folder id.
  let folder;
  if (siteId && driveId) {
    try {
      folder = await getFolderByPath(token, driveId, spFolderPath);
      if (!folder) {
        // Use the origin encoded path.
        const folderData = await graphFetch(token, `/drives/${driveId}/root:/${spFolderPath}`);
        if (folderData) {
          folder = {
            folderId: folderData.id,
            driveId: folderData.parentReference.driveId,
          };
        }
      }
    } catch (error2) {
      core.info(`Did not find folder info for ${siteId} / ${decodedFolderPath}: ${error2.message}.`);
      core.info('>> Trying to find it by digging in a little...');

      // Folder path is a link, so try to find the drive id that it represents.
      try {
        folder = await findDriveAndFolderId(token, siteId, decodedFolderPath);
      } catch (error3) {
        core.warning(`Failed to get folder info for ${siteId}: ${error3.message}`);
      }
    }

    if (folder) {
      core.info(`✅ Drive ID: ${folder.driveId}`);
      core.info(`✅ Folder ID: ${folder.folderId}`);
      core.setOutput('drive_id', folder.driveId);
      core.setOutput('folder_id', folder.folderId);
    } else {
      core.setOutput('error_message', '❌ Error: Failed to get drive and/or folder Id.');
    }
  }
}

await run();
