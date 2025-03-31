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

try {
  const callbacks = core.getInput('aemy_callbacks');
  const aemyContext = core.getInput('aemy_context');
  const uploadSource = core.getInput('upload_source');
  const uploadTarget = core.getInput('upload_target');

  core.setOutput('results', `Received callbacks: ${!!callbacks}, context: ${!!aemyContext}, source: ${!!uploadSource}, target: ${!!uploadTarget}`);
} catch (error) {
  core.setFailed(error.message);
}
