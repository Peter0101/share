import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';

dotenv.config();
const file = path.resolve(process.env.DATABASE_PATH || './data/screen-share.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS User (
 id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('ADMIN','USER')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS Room (
 id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 owner_id INTEGER NOT NULL REFERENCES User(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS RoomPermission (
 room_id INTEGER NOT NULL REFERENCES Room(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES User(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('HOST','VIEWER')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS room_permission_user_idx ON RoomPermission(user_id);
`);
if (!db.prepare('PRAGMA table_info(User)').all().some((column) => column.name === 'role')) db.exec("ALTER TABLE User ADD COLUMN role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('ADMIN','USER'))");
export const userByEmail = (email) => db.prepare('SELECT id,email,password_hash,role FROM User WHERE email=?').get(email);
export const userById = (id) => db.prepare('SELECT id,email,role FROM User WHERE id=?').get(id);
export const users = () => db.prepare('SELECT id,email,role,created_at FROM User ORDER BY email COLLATE NOCASE').all();
export const userWithPassword = (id) => db.prepare('SELECT id,email,password_hash,role FROM User WHERE id=?').get(id);
export const createUser = ({ email, passwordHash, role }) => db.prepare('INSERT INTO User(email,password_hash,role) VALUES(?,?,?)').run(email,passwordHash,role);
export const updateUser = (id, { email, role, passwordHash }) => {
 const fields = []; const values = [];
 if (email) { fields.push('email=?'); values.push(email); }
 if (role) { fields.push('role=?'); values.push(role); }
 if (passwordHash) { fields.push('password_hash=?'); values.push(passwordHash); }
 if (!fields.length) return;
 values.push(id); db.prepare(`UPDATE User SET ${fields.join(',')} WHERE id=?`).run(...values);
};
export const deleteUser = (id) => db.prepare('DELETE FROM User WHERE id=?').run(id);
export const roomForUser = (slug, userId) => db.prepare(`
 SELECT r.id,r.slug,r.name,r.owner_id,CASE WHEN r.owner_id=@userId THEN 'OWNER' ELSE p.role END role
 FROM Room r LEFT JOIN RoomPermission p ON p.room_id=r.id AND p.user_id=@userId
 WHERE r.slug=@slug AND (r.owner_id=@userId OR p.user_id IS NOT NULL)
`).get({ slug, userId });
export const roomsForUser = (userId) => db.prepare(`
 SELECT r.slug,r.name,CASE WHEN r.owner_id=@userId THEN 'OWNER' ELSE p.role END role
 FROM Room r LEFT JOIN RoomPermission p ON p.room_id=r.id AND p.user_id=@userId
 WHERE r.owner_id=@userId OR p.user_id IS NOT NULL ORDER BY r.name COLLATE NOCASE
`).all({ userId });
export const userForPermission = (id) => db.prepare('SELECT id,email FROM User WHERE id=?').get(id);
export const savePermission = (roomId,userId,role) => db.prepare(`
 INSERT INTO RoomPermission(room_id,user_id,role) VALUES(?,?,?)
 ON CONFLICT(room_id,user_id) DO UPDATE SET role=excluded.role
`).run(roomId,userId,role);
export const createRoom = ({ slug, name, ownerId }) => {
 db.exec('BEGIN');
 try {
  const result = db.prepare('INSERT INTO Room(slug,name,owner_id) VALUES(?,?,?)').run(slug,name,ownerId);
  const roomId = Number(result.lastInsertRowid);
  db.prepare('INSERT INTO RoomPermission(room_id,user_id,role) VALUES(?,?,?)').run(roomId,ownerId,'HOST');
  db.exec('COMMIT');
  return { id: roomId, slug, name, owner_id: ownerId, role: 'OWNER' };
 } catch (error) { db.exec('ROLLBACK'); throw error; }
};
