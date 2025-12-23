import { getDbInstance, getDb, allDb } from '../database/connection';

export interface User {
  id: number;
  username: string;
  hashed_password?: string; // Optional, as not always needed by consumers
  two_factor_secret?: string | null;
  created_at: number;
  updated_at: number;
}

export class UserRepository {
  async findUserById(id: number): Promise<User | null> {
    const db = await getDbInstance();
    const sql =
      'SELECT id, username, hashed_password, two_factor_secret, created_at, updated_at FROM users WHERE id = ?';
    const user = await getDb<User>(db, sql, [id]);
    return user ?? null;
  }

  async findUserByUsername(username: string): Promise<User | null> {
    const db = await getDbInstance();
    const sql =
      'SELECT id, username, hashed_password, two_factor_secret, created_at, updated_at FROM users WHERE username = ?';
    const user = await getDb<User>(db, sql, [username]);
    return user ?? null;
  }

  // Add other user-related methods if needed, e.g., createUser, updateUserPassword, etc.
}

export const userRepository = new UserRepository();
