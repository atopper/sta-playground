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
import path from 'path';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

// Sleep function using Promise
async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function graphFetch(token, endpoint, initOptions) {
  core.info(`Accessing Graph API endpoint: ${GRAPH_API}${endpoint}`);
  const res = await fetch(
    `${GRAPH_API}${endpoint}`,
    initOptions,
  );

  if (!res.ok) {
    const errorText = await res.text();
    core.warning(`Graph API error ${res.status}: ${errorText}`);
    throw new Error(`Graph API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 *
 * @param accessToken SharePoint access token
 * @param driveId Destination root drive id
 * @param folderId Destination folder id within the drive id root
 * @param file The name and full, local path to the file to be uploaded.
 * @returns {Promise<boolean>}
 */
async function uploadFile(accessToken, driveId, folderId, file) {
  const fileStream = fs.createReadStream(file.path);

  try {
    const response = await graphFetch(
      accessToken,
      `/drives/${driveId}/items/${folderId}:${file.path}/content`,
      {
        method: 'PUT',
        body: fileStream,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          Accept: 'application/json',
        },
      },
    );

    core.info(`File ${file.path} uploaded successfully. ${JSON.stringify(response)}`);

    return !!response;
  } catch (error) {
    core.warning(`Failed to upload file ${file.path}: ${error.message}`);
  }

  return false;
}

/**
 * Create the folders in SharePoint if they don't exist.
 * @param accessToken
 * @param driveId The root drive id for the SharePoint site
 * @param folderId The folder id for the SharePoint site, under the drive.
 * @param sourceFolders The folders to create (name and relative path to the mountpoint)
 * @param uploadReport
 * @returns {Promise<boolean>}
 */
async function createFoldersIfNecessary(
  accessToken,
  driveId,
  folderId,
  sourceFolders,
  uploadReport,
) {
  const folderMap = new Map();
  folderMap.set('', folderId);

  for (const folder of sourceFolders) {
    const segments = folder.path.split('/');
    // Current path is the path as we increment through the segments.
    let currentPath;
    // The parent id is the id of the folder we are creating the next segment in.
    let parentId = folderId;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      if (folderMap.has(currentPath)) {
        parentId = folderMap.get(currentPath);
      } else {
        // Create/check folder
        const url = `${GRAPH_API}/drives/${driveId}/items/${parentId}/children`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: segment,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          }),
        });

        if (res.ok) {
          const data = await res.json();
          folderMap.set(currentPath, data.id);
          parentId = data.id;
        } else if (res.status === 409) {
          // Already exists - get its data.
          const existing = await graphFetch(
            accessToken,
            `/drives/${driveId}/items/${parentId}/children?$filter=name eq '${segment}'`,
          );
          if (!existing?.value || existing.value.length === 0) {
            core.warning(`Failed to get data for existing folder ${currentPath}: ${res.status} ${res.statusText}`);
            // eslint-disable-next-line no-param-reassign
            throw new Error(`Failed to get data for existing folder ${currentPath}. Upload is aborted.`);
          } else if (existing.value.length !== 1) {
            core.warning(`Found multiple existing folders for ${currentPath}.`);
            // eslint-disable-next-line no-param-reassign
            throw new Error(`Found multiple existing folders for ${currentPath}. Upload is aborted.`);
          }
          const { id } = existing.value[0];
          folderMap.set(currentPath, id);
          parentId = id;
        } else {
          core.warning(`Failed to create folder ${currentPath}: ${res.status} ${res.statusText}`);
          // eslint-disable-next-line no-param-reassign
          uploadReport.failedFolderCreations += 1;
          throw new Error(`Failed to create folder ${currentPath}. Upload is aborted.`);
        }
      }
    }
  }
}

/**
 * Recursively get the structure of the source folder.  This is used to
 * determine the folder structure to create in SharePoint and simplify
 * the upload of files, using their full path, knowing the destination
 * folders already exist.
 * @param srcFolder
 * @param structure
 * @returns {Promise<*>}
 */
async function getSourceStructure(srcFolder, structure = undefined) {
  const newStructure = structure || {
    folders: [],
    files: [],
  };
  const entries = fs.readdirSync(srcFolder, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(srcFolder, entry.name);

    if (entry.isDirectory()) {
      core.debug(`Adding directory and recursing it: ${entry.name}`);
      newStructure.folders.push({
        name: entry.name,
        path: fullPath,
      });
      await getSourceStructure(fullPath, structure);
    } else if (entry.isFile()) {
      core.debug(`Adding file: ${entry.name}`);
      newStructure.files.push({
        name: entry.name,
        path: fullPath,
      });
    } else {
      core.debug(`Skipping non-file/non-directory item: ${entry.name}`);
    }
  }

  return newStructure;
}

/**
 * Upload all the files from a source folder to SharePoint.  For each sub-folder
 * encountered, ensure it is created in SharePoint, and then recursively upload that
 * folder's contents.
 * @param accessToken SharePoint access token
 * @param driveId Destination root drive id
 * @param folderId Destination folder id within the drive id root
 * @param sourceFiles The local path to each file to be uploaded.
 * @param delay The delay, in milliseconds
 * @param uploadReport
 * @returns {Promise<void>}
 */
async function uploadFiles(accessToken, driveId, folderId, sourceFiles, delay, uploadReport) {
  for (const item of sourceFiles) {
    core.debug(`Uploading file: ${item.path}`);
    const success = await uploadFile(accessToken, driveId, folderId, item);
    if (success) {
      // eslint-disable-next-line no-param-reassign
      uploadReport.uploads += 1;
    } else {
      // eslint-disable-next-line no-param-reassign
      uploadReport.failures += 1;
      uploadReport.failedList.push(item);
    }

    await sleep(delay);
  }
}

/**
 * Given a folder full of import content to upload, and the necessary
 * @returns {Promise<void>}
 */
export async function run() {
  const accessToken = core.getInput('access_token');
  const driveId = core.getInput('drive_id'); // Shared Documents
  const folderId = core.getInput('folder_id'); // sites/esaas-demos/andrew-top
  const zipDir = core.getInput('zip_dir');
  const delay = core.getInput('delay');
  const uploadReport = {
    uploads: 0,
    failures: 0,
    failedList: [],
    failedFolderCreations: 0,
  };

  core.info(`Upload files from ${zipDir} with a delay of ${delay} milliseconds between uploads.`);

  try {
    // Get the source structure (folders, files, etc.).
    const sourceData = await getSourceStructure(zipDir);

    // Now create the folder structure in SharePoint, if necessary.
    await createFoldersIfNecessary(
      accessToken,
      driveId,
      folderId,
      sourceData.folders.map((folder) => ({
        name: folder.name,
        path: folder.path.replace(zipDir, ''),
      })),
      uploadReport,
    );

    // Now upload each file, knowing the destination folders already exist.
    await uploadFiles(accessToken, driveId, folderId, sourceData.files, delay, uploadReport);
    core.info(`Upload report: ${JSON.stringify(uploadReport)}`);
    core.setOutput('upload_failed_list', uploadReport.failedList.join(', '));
    core.setOutput('upload_successes', uploadReport.uploads);
    core.setOutput('upload_failures', uploadReport.uploads);
    if (uploadReport.uploads > 0 || uploadReport.failedList.length > 0) {
      core.setOutput('error_message', '❌ Upload Error: Some uploads failed. Check the workflow for more details.');
    }
  } catch (error) {
    core.warning(`Failed upload the files: ${error.message}`);
    core.setOutput('error_message', `❌ Upload Error: ${error.message}`);
  }
}

await run();
