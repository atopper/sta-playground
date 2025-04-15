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
import forge from 'node-forge';
import crypto from 'crypto';

function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createJWTHeaderAndPayload(thumbprint, tenantId, clientId, duration) {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/v2.0`;
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
    jti: crypto.randomUUID(),
    nbf: now,
    exp: now + duration, // 60 minutes
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
  const duration = core.getInput('duration');

  core.info(`Getting data for "${tenantId} : ${clientId}". Expecting ${duration} seconds.`);

  try {
    // Decode the PFX
    const pfxDer = forge.util.decode64(base64key);
    const p12Asn1 = forge.asn1.fromDer(pfxDer);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, true, password);

    // Extract private key
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
    if (!privateKey) {
      throw new Error('No private key found in PFX.');
    }
    core.info(`Private key extracted successfully and has length of ${privateKey.n.bitLength()} bits.`);
    const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
    core.info(`Private key PEM extracted successfully and has length of ${privateKeyPem.length} bytes.`);

    // If the certificate is ever required:
    // const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    // const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;
    // if (!cert) {
    //   throw new Error(' No certificate found in PFX.');
    // }
    // const certificatePem = forge.pki.certificateToPem(cert);

    // Create JWT
    const { header, payload } = createJWTHeaderAndPayload(thumbNail, tenantId, clientId, duration);
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    // Sign token
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedToken);
    const signature = sign.sign(privateKeyPem, 'base64url');
    const clientAssertion = `${unsignedToken}.${signature}`;
    core.info('Token has been signed.');

    const data = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
      scope: 'https://graph.microsoft.com/.default',
    }).toString();

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: data,
    });
    if (!response.ok) {
      core.warning(`Failed to fetch token: ${response.status} ${response.statusText}`);
    } else {
      const responseJson = await response.json();
      core.setOutput('access_token', responseJson.access_token);
    }
  } catch (error) {
    core.warning(`Failed to extract access token: ${error.message}`);
  }
}

await run();
