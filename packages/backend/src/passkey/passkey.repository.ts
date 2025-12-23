import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import { ErrorFactory } from '../utils/AppError';

export interface Passkey {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null; // JSON string
  name: string | null;
  backed_up: boolean; // SQLite stores booleans as 0 or 1
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface NewPasskey {
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports?: string | null; // JSON string
  name?: string | null;
  backed_up?: boolean;
}

// Helper to convert DB result (0/1) to boolean for backed_up field
function mapPasskeyResult(dbResult: any): Passkey | null {
  if (!dbResult) return null;
  return {
    ...dbResult,
    backed_up: !!dbResult.backed_up, // Ensure boolean
    transports: dbResult.transports, // Already string or null
    created_at:
      typeof dbResult.created_at === 'string'
        ? parseInt(dbResult.created_at, 10)
        : dbResult.created_at,
    last_used_at:
      dbResult.last_used_at && typeof dbResult.last_used_at === 'string'
        ? parseInt(dbResult.last_used_at, 10)
        : dbResult.last_used_at,
    updated_at:
      typeof dbResult.updated_at === 'string'
        ? parseInt(dbResult.updated_at, 10)
        : dbResult.updated_at,
  };
}

function mapPasskeyResults(dbResults: any[]): Passkey[] {
  return dbResults.map((row) => ({
    ...row,
    backed_up: !!row.backed_up,
    transports: row.transports,
    created_at: typeof row.created_at === 'string' ? parseInt(row.created_at, 10) : row.created_at,
    last_used_at:
      row.last_used_at && typeof row.last_used_at === 'string'
        ? parseInt(row.last_used_at, 10)
        : row.last_used_at,
    updated_at: typeof row.updated_at === 'string' ? parseInt(row.updated_at, 10) : row.updated_at,
  }));
}

export class PasskeyRepository {
  async createPasskey(passkeyData: NewPasskey): Promise<Passkey> {
    const db = await getDbInstance();
    const sql = `
      INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name, backed_up, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
      RETURNING *
    `;
    // Note: RETURNING * might not work as expected with the 'sqlite3' package's run method.
    // We'll do a SELECT after INSERT if needed, or rely on lastID and then select.
    // For simplicity with 'sqlite3', we'll insert then select.

    const insertSql = `
      INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name, backed_up, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
    `;
    const params = [
      passkeyData.user_id,
      passkeyData.credential_id,
      passkeyData.public_key,
      passkeyData.counter,
      passkeyData.transports ?? null,
      passkeyData.name ?? null,
      passkeyData.backed_up ? 1 : 0, // Store boolean as 0 or 1
    ];

    const { lastID } = await runDb(db, insertSql, params);

    // Fetch the inserted row
    const newPasskey = await this.getPasskeyById(lastID);
    if (!newPasskey) {
      throw ErrorFactory.databaseError(
        'Passkey 创建失败',
        'Failed to create or retrieve passkey after insert.'
      );
    }
    return newPasskey;
  }

  async getPasskeyById(id: number): Promise<Passkey | null> {
    const db = await getDbInstance();
    const sql = 'SELECT * FROM passkeys WHERE id = ?';
    const result = await getDb<any>(db, sql, [id]);
    return mapPasskeyResult(result);
  }

  async getPasskeyByCredentialId(credentialId: string): Promise<Passkey | null> {
    const db = await getDbInstance();
    const sql = 'SELECT * FROM passkeys WHERE credential_id = ?';
    const result = await getDb<any>(db, sql, [credentialId]);
    return mapPasskeyResult(result);
  }

  async getPasskeysByUserId(userId: number): Promise<Passkey[]> {
    const db = await getDbInstance();
    const sql = 'SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC';
    const results = await allDb<any>(db, sql, [userId]);
    // Log the raw results from the database before mapping
    // console.log(`[PasskeyRepository] Raw passkeys for user ${userId}:`, JSON.stringify(results, null, 2));
    return mapPasskeyResults(results);
  }

  async updatePasskeyCounter(credentialId: string, newCounter: number): Promise<boolean> {
    const db = await getDbInstance();
    const sql =
      "UPDATE passkeys SET counter = ?, updated_at = strftime('%s', 'now') WHERE credential_id = ?";
    const { changes } = await runDb(db, sql, [newCounter, credentialId]);
    return changes > 0;
  }

  async updatePasskeyLastUsedAt(credentialId: string): Promise<boolean> {
    const db = await getDbInstance();
    const sql =
      "UPDATE passkeys SET last_used_at = strftime('%s', 'now'), updated_at = strftime('%s', 'now') WHERE credential_id = ?";
    const { changes } = await runDb(db, sql, [credentialId]);
    return changes > 0;
  }

  async deletePasskey(credentialId: string): Promise<boolean> {
    const db = await getDbInstance();
    const sql = 'DELETE FROM passkeys WHERE credential_id = ?';
    const { changes } = await runDb(db, sql, [credentialId]);
    return changes > 0;
  }

  async deletePasskeysByUserId(userId: number): Promise<boolean> {
    const db = await getDbInstance();
    const sql = 'DELETE FROM passkeys WHERE user_id = ?';
    const { changes } = await runDb(db, sql, [userId]);
    return changes > 0;
  }

  async updatePasskeyName(credentialId: string, name: string): Promise<boolean> {
    const db = await getDbInstance();
    const sql =
      "UPDATE passkeys SET name = ?, updated_at = strftime('%s', 'now') WHERE credential_id = ?";
    const { changes } = await runDb(db, sql, [name, credentialId]);
    return changes > 0;
  }

  async getFirstPasskey(): Promise<Passkey | null> {
    const db = await getDbInstance();
    const sql = 'SELECT * FROM passkeys LIMIT 1';
    const result = await getDb<any>(db, sql);
    return mapPasskeyResult(result);
  }
}

export const passkeyRepository = new PasskeyRepository();
