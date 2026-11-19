import express from 'express';
import cors from 'cors'
import { MongoClient } from 'mongodb';
import 'dotenv/config'
const app = express();
const port = process.env.PORT || 5000;


//middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.oc3n5pn.mongodb.net/`);

export async function connectToMongoDB() {
          try {
                    await client.connect();
                    console.log("You successfully connected to MongoDB!");
                    return client;
          } catch (err) {
                    console.dir(err);
          }
}

const connectedClient = await connectToMongoDB();

app.get('/', (req, res) => {
          res.send('rent gear is gearing')
})

app.listen(port, () => {
          console.log(`rent gear is running on port ${port}`)
})