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
// import { CallbackClient } from '@adobe-aem-foundation/site-transfer-shared-coordinator';

const sendCallback = async (url, body, apiKey) => {
  const headers = new Headers();
  headers.set('x-api-key', apiKey);

  if (body instanceof FormData) {
    headers.delete('Content-Type');
  } else {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to send callback: ${response.statusText}`);
  }
};

export async function run() {
  const context = core.getInput('context');
  const callbacks = core.getInput('callbacks');
  const message = core.getInput('message');
  const statusType = core.getInput('status_type');
  const agentName = core.getInput('agent_name');

  const name = `${agentName || 'sta'}-status`;

  try {
    if (!context || !callbacks || !message || !statusType) {
      core.info(`Missing parameters in ${name} call. Skipping status.`);
      return;
    }

    const coordinatorContext = JSON.parse(context);
    const coordinatorCallbacks = JSON.parse(callbacks);

    // const payload = {
    //   function: name,
    //   parameters: {},
    //   callbacks: coordinatorCallbacks,
    //   context: coordinatorContext,
    // };

    core.info(`${statusType} status message: ${message}`);

    if (!['ok', 'error', 'progress'].includes(statusType)) {
      core.info(`Invalid status type ${statusType} in ${name}.`);
      core.setFailed(`Invalid status type ${statusType} in ${name}.`);
      return;
    }

    const url = coordinatorCallbacks[statusType];
    let body = JSON.stringify({
      coordinatorContext,
      response: {
        message,
      },
    });

    if (statusType === 'ok') {
      const formData = new FormData();
      // add context to form data
      const contextBlob = new Blob([JSON.stringify(coordinatorContext || {})], { type: 'application/json' });
      formData.append('context', contextBlob, 'context.json');

      // add message to form data
      const responseBlob = new Blob([JSON.stringify({ message })], { type: 'application/json' });
      formData.append('response', responseBlob, 'response.json');
      body = formData;
    }

    await sendCallback(url, body, coordinatorCallbacks.apiKey);

    core.info(`Status ${statusType}:${message} sent successfully in ${name} call.`);
  } catch (error) {
    const errorResult = {
      status: 'failure',
      message: `Failed to send status of type ${statusType} in ${name}: ${error.message}`,
    };
    core.info(`Error: ${JSON.stringify(errorResult)}`);
    core.setFailed(error);
  } finally {
    if (statusType === 'error') {
      process.exit(1);
    }
  }
}

run();
