import { MongoClient } from 'mongodb';
import 'dotenv/config';

/**
 * Single shared MongoDB connection for the whole API.
 *
 * This is the same `rent-gear` database the Next.js client (better-auth)
 * writes to, so the auth middleware can read the `user` and `jwks`
 * collections created by better-auth without a second connection.
 */
const client = new MongoClient(
   `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.oc3n5pn.mongodb.net/`
);

export async function connectToMongoDB() {
   try {
      await client.connect();
      console.log("You successfully connected to MongoDB!");
      return client;
   } catch (err) {
      console.dir(err);
      throw err;
   }
}

const connectedClient = await connectToMongoDB();

export const database = connectedClient.db('rent-gear');
export const users = database.collection('user');
export const equipments = database.collection('equipments');
export const favourites = database.collection('favourites');
/** better-auth JWT plugin signing keys (public/private JWKs). */
export const jwks = database.collection('jwks');
