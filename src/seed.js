import bcrypt from 'bcrypt';
import { db } from './db.js';
const addUser = db.prepare(`INSERT INTO User(email,password_hash,role) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role`);
const getUser = db.prepare('SELECT id FROM User WHERE email=?');
const addRoom = db.prepare(`INSERT INTO Room(slug,name,owner_id) VALUES(?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,owner_id=excluded.owner_id`);
const getRoom = db.prepare('SELECT id FROM Room WHERE slug=?');
const addPermission = db.prepare(`INSERT INTO RoomPermission(room_id,user_id,role) VALUES(?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET role=excluded.role`);
db.exec('BEGIN');
try {
 addUser.run('admin@example.com', bcrypt.hashSync('Admin123!', 12), 'ADMIN');
 addUser.run('host@example.com', bcrypt.hashSync('Host123!', 12), 'USER');
 addUser.run('viewer@example.com', bcrypt.hashSync('Viewer123!', 12), 'USER');
 const host = getUser.get('host@example.com'); const viewer = getUser.get('viewer@example.com');
 addRoom.run('daily-dev','Daily Development',host.id); const room = getRoom.get('daily-dev');
 addPermission.run(room.id,host.id,'HOST'); addPermission.run(room.id,viewer.id,'VIEWER');
 db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
console.log('Seed concluido: admin@example.com, daily-dev, host@example.com e viewer@example.com.');
db.close();
