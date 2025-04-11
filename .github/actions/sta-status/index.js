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
import { CallbackClient, StatusMessage } from '@adobe-aem-foundation/site-transfer-shared-coordinator';

export async function run() {
  const context = core.getInput('context');
  const callbacks = core.getInput('callbacks');
  const message = core.getInput('message');
  const statusType = core.getInput('status_type');
  const agentName = core.getInput('agent_name');

  const name = `${agentName || 'sta'}-status`;

  if (!context || !callbacks || !message || !statusType) {
    core.setOutput('result', `Missing parameters in ${name} call.`);
    return;
  }

  try {
    const coordinatorContext = JSON.parse(callbacks);
    const coordinatorCallbacks = JSON.parse(callbacks);

    const payload = {
      function: name,
      parameters: {},
      callbacks: coordinatorCallbacks,
      context: coordinatorContext,
    };

    console.log(`${statusType} status message: ${message}`);

    const client = CallbackClient(payload);
    if (statusType === 'progress') {
      await client.sendProgress({
        status: 'running',
        message,
      });
    } else if (statusType === 'ok') {
      await client.sendComplete(undefined, {
        message,
        testPaths: [],
      });
    } else if (statusType === 'error') {
      await client.sendError(message);
    } else {
      core.setOutput('result', `Invalid status type: ${statusType} in ${name} call.`);
      return;
    }

    core.setOutput('result', JSON.stringify(`Status ${statusType} sent successfully in ${name} call.`));
    if (statusType === 'error') {
      process.exit(1);
    }
  } catch (error) {
    const errorResult = {
      status: 'failure',
      message: `Failed to send status of type ${statusType} in ${name}: ${error.message}`,
    };
    core.setOutput('result', JSON.stringify(errorResult));
    core.setFailed(error);
  }
}

run();
