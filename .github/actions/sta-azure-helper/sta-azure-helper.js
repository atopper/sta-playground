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
    jti: crypto.randomUUID(),
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

  // const pfxPath = './temp.pfx';
  // const keyPath = './key.pem';
  // const certPath = './cert.pem';
  // try {
  //   fs.writeFileSync(pfxPath, Buffer.from(base64key, 'base64'));
  //   execSync(`openssl pkcs12 -in ${pfxPath} -out ${keyPath} -nocerts -nodes -passin pass:${password}`);
  //   execSync(`openssl pkcs12 -in ${pfxPath} -out ${certPath} -clcerts -nokeys -passin pass:${password}`);
  // } catch (err) {
  //   core.setFailed(`Failed to extract key from PFX: ${err}`);
  //   process.exit(1);
  // }

  try {
    // Decode the PFX
    const pfxDer = forge.util.decode64(base64key);
    const p12Asn1 = forge.asn1.fromDer(pfxDer);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // Extract private key
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
    if (!privateKey) {
      throw new Error('No private key found in PFX.');
    }
    const privateKeyPem = forge.pki.privateKeyToPem(privateKey);

    // const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    // const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;
    // if (!cert) {
    //   throw new Error(' No certificate found in PFX.');
    // }
    // const certificatePem = forge.pki.certificateToPem(cert);

    // Create JWT
    const { header, payload } = createJWTHeaderAndPayload(thumbNail, tenantId, clientId);
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedToken);
    const signature = sign.sign(privateKey, 'base64url');
    const clientAssertion = `${unsignedToken}.${signature}`;

    const data = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
      scope: 'https://graph.microsoft.com/.default',
    }).toString();

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(tokenEndpoint, options, (res) => {
      let response = '';
      res.on('data', (chunk) => response += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = JSON.parse(response);
          core.setOutput('access_token', body.access_token);
        } else {
          core.warning(`Failed to get token: ${res.statusCode} ${response}`);
        }
      });
    });
    req.on('error', (e) => core.warning(`Request failed: ${e.message}`));
    req.write(data);
    req.end();
  } catch (error) {
    core.warning(`Failed to extract access token: ${error.message}`);
  }
}

await run();
