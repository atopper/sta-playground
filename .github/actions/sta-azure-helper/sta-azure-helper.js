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
import { execSync } from 'child_process';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createJWTHeaderAndPayload(thumbprint, tenantId, clientId) {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    x5t: thumbprint,
  };

  const payload = {
    aud: tokenUrl,
    iss: clientId,
    sub: clientId,
    jti: uuidv4(),
    nbf: now,
    exp: now + 3600, // 60 minutes
  };

  return { header, payload };
}

/**
 * Get the site and drive ID for a SharePoint site.
 * @returns {Promise<void>}
 */
export async function run() {
  const tenantId = core.getInput('tenant_id');
  const clientId = core.getInput('client_id');
  const thumbNail = core.getInput('thumbnail');
  const base64key = core.getInput('key');
  const password = core.getInput('password');

  core.info(`Getting data for "${tenantId} : ${clientId}".`);

  const pfxPath = './temp.pfx';
  const keyPath = './key.pem';
  const certPath = './cert.pem';
  try {
    fs.writeFileSync(pfxPath, Buffer.from(base64key, 'base64'));
    execSync(`openssl pkcs12 -in ${pfxPath} -out ${keyPath} -nocerts -nodes -passin pass:`);
    execSync(`openssl pkcs12 -in ${pfxPath} -out ${certPath} -clcerts -nokeys -passin pass:`);
  } catch (err) {
    core.setFailed(`Failed to extract key from PFX: ${err}`);
    process.exit(1);
  }

  try {
    const { header, payload } = createJWTHeaderAndPayload(thumbNail, tenantId, clientId);
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const privateKey = fs.readFileSync(keyPath, 'utf8');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(dataToSign);
    const signature = sign.sign(privateKeyPem, 'base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const clientAssertion = `${dataToSign}.${signature}`;
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        scope: 'https://graph.microsoft.com/.default',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      core.warning(`Failed to get token: ${JSON.stringify(result)}`);
    } else {
      core.setOutput('access_token', result.access_token);
    }
  } catch (error) {
    core.warning(`Failed to extract access token: ${error.message}`);
  }
}

await run();
