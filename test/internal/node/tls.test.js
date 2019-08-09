/**
 * Copyright (c) 2002-2019 "Neo4j,"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import neo4j from '../../../src'
import path from 'path'
import sharedNeo4j from '../shared-neo4j'
import {
  ServerVersion,
  VERSION_4_0_0
} from '../../../src/internal/server-version'

describe('#integration trust', () => {
  let serverVersion

  beforeAll(async () => {
    const driver = neo4j.driver('bolt://localhost', sharedNeo4j.authToken)
    try {
      serverVersion = await ServerVersion.fromDriver(driver)
    } finally {
      driver.close()
    }
  })

  beforeEach(() => {
    if (serverVersion.compareTo(VERSION_4_0_0) >= 0) {
      pending('address within security work')
    }
  })

  describe('trust-all-certificates', () => {
    let driver

    afterEach(() => {
      if (driver) {
        driver.close()
      }
    })

    it('should work with default certificate', done => {
      // Given
      driver = neo4j.driver('bolt://localhost', sharedNeo4j.authToken, {
        encrypted: 'ENCRYPTION_ON',
        trust: 'TRUST_ALL_CERTIFICATES'
      })

      // When
      driver
        .session()
        .run('RETURN 1')
        .then(result => {
          expect(result.records[0].get(0).toNumber()).toBe(1)
          done()
        })
    })
  })

  describe('trust-custom-ca-signed-certificates', () => {
    let driver

    afterEach(() => {
      if (driver) {
        driver.close()
      }
    })

    it('should reject unknown certificates', done => {
      // Given
      driver = neo4j.driver('bolt://localhost', sharedNeo4j.authToken, {
        encrypted: true,
        trust: 'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES',
        trustedCertificates: ['test/resources/random.certificate']
      })

      // When
      driver
        .session()
        .run('RETURN 1')
        .catch(err => {
          expect(err.message).toContain('Server certificate is not trusted')
          done()
        })
    })

    it('should accept known certificates', done => {
      // Given
      driver = neo4j.driver('bolt://localhost', sharedNeo4j.authToken, {
        encrypted: true,
        trust: 'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES',
        trustedCertificates: [neo4jCertPath()]
      })

      // When
      driver
        .session()
        .run('RETURN 1')
        .then(done)
    })
  })

  describe('trust-system-ca-signed-certificates', () => {
    let driver

    afterEach(() => {
      if (driver) {
        driver.close()
      }
    })

    it('should reject unknown certificates', done => {
      // Given
      driver = neo4j.driver('bolt://localhost', sharedNeo4j.authToken, {
        encrypted: true,
        trust: 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES'
      })

      // When
      driver
        .session()
        .run('RETURN 1')
        .catch(err => {
          expect(err.message).toContain('Server certificate is not trusted')
          done()
        })
    })
  })

  function neo4jCertPath () {
    return sharedNeo4j.neo4jCertPath(path.join('build', 'neo4j'))
  }
})
