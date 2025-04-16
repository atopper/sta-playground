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
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'yaml';

/**
 * Extracts the mountpoint data from the given mountpoint value.
 * @param mountpointValue
 * @param type
 * @returns {{}}
 */
function getMountPointData(mountpointValue, type) {
  const url = new URL(mountpointValue);
  const mountPointData = {
    host: `${url.protocol}//${url.host}`,
  };

  if (type === 'sharepoint') {
    let pathParts;
    [mountPointData.site, ...pathParts] = url.pathname.split('/sites/')[1].split('/');
    mountPointData.path = pathParts ? pathParts.join('/') : undefined;
    if (!mountPointData.host || !mountPointData.site || !mountPointData.path) {
      throw new Error('Mount point URL is not in the expected format.');
    }
  } else if (type === 'crosswalk') {
    mountPointData.path = url.pathname.substring(1);
  }

  return JSON.stringify(mountPointData);
}

/**
 * Reads the fstab.yml file and returns the mountpoint for '/'.
 * @returns {string}
 */
function getRootMountPoint() {
  const filePath = join(process.env.GITHUB_WORKSPACE, 'fstab.yml');
  const fileContent = readFileSync(filePath, 'utf8');
  const parsed = yaml.parse(fileContent);
  const mountpoints = parsed?.mountpoints || {};
  return mountpoints['/'];
}

/**
 * Reads the fstab.yml file and determines the mountpoint type.
 * If successful, ensures the type matches the provided desired type.
 * @returns {Promise<void>}
 */
export async function run() {
  try {
    const desiredMountPointType = core.getInput('mountpoint_type');
    if (!['sharepoint', 'crosswalk'].includes(desiredMountPointType)) {
      throw new Error(`Invalid requested mountpoint type: ${desiredMountPointType}`);
    }

    let rootEntry = core.getInput('mountpoint');
    if (rootEntry) {
      core.info(`mountpoint provided: ${rootEntry}`);
    } else {
      rootEntry = getRootMountPoint();
      core.info(`mountpoint extracted: ${rootEntry}`);
    }
    if (!rootEntry) {
      throw new Error('No mountpoint for \'/\' found in fstab.yml');
    }

    // Determine string content from object or string
    let mountpointValue = '';
    if (typeof rootEntry === 'string') {
      mountpointValue = rootEntry;
    } else if (typeof rootEntry === 'object') {
      mountpointValue = rootEntry.url;
    }
    if (!mountpointValue) {
      throw new Error('Found mountpoint value is empty');
    }

    core.info(`mountpoint: ${mountpointValue}`);

    // Determine the type
    let type = 'unknown';
    if (/sharepoint/i.test(mountpointValue)) {
      type = 'sharepoint';
    } else if (/adobeaemcloud/i.test(mountpointValue)) {
      type = 'crosswalk';
    } else if (/drive\.google\.com/i.test(mountpointValue)) {
      throw new Error('Google is not supported for upload yet.');
    } else if (/dropbox/i.test(mountpointValue)) {
      throw new Error('Dropbox is not supported for upload.');
    } else if (/github\.com/i.test(mountpointValue)) {
      throw new Error('GitHub is not supported for upload.');
    } else {
      throw new Error(`This mountpoint is not supported for upload: ${mountpointValue}`);
    }

    if (type !== desiredMountPointType) {
      throw new Error(`Requested mountpoint type ${desiredMountPointType} does not match found mountpoint type found: ${type}`);
    }

    core.setOutput('mountpoint', mountpointValue);
    core.setOutput('type', type);
    core.setOutput('data', getMountPointData(mountpointValue, type));

    core.info(`✅ mountpoint: ${mountpointValue}`);
    core.info(`✅ type: ${type}`);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      core.warning('❌ Error: A mountpoint was not provided and the fstab.yml was not found');
      core.setOutput('error_message', '❌ Error: mountpoint was not provided and the fstab.yml was not found');
    } else if (error.name.startsWith('YAML')) {
      core.warning(`❌ Error: The fstab.yml file is not valid YAML: : ${error.message}`);
      core.setOutput('error_message', `❌ Error: The fstab.yml file is not valid YAML: ${error.message}`);
    } else {
      core.warning(`❌ Error: ${error.message}`);
      core.setOutput('error_message', `❌ Error: ${error.message}`);
    }
  }
}

await run();
