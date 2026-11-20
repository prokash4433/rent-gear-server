import express from 'express';
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';
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
const database = connectedClient.db('rent-gear');
const users = database.collection('user');
const equipments = database.collection('equipments');

app.get('/', (req, res) => {
          res.send('rent gear is gearing')
})

//user reated apis
app.get('/users', async(req, res)=>{
   const cursor = users.find({});
   const result = await cursor.toArray();
   res.send(result);
} )


//equipment related apis
app.get('/equipments', async(req, res)=>{
   const cursor = equipments.find();
   const result = await cursor.toArray();
   res.send(result);
})

app.post('/equipments', async(req,res) =>{
   const equipmentData = req.body;
   const result = await equipments.insertOne(equipmentData) ;
   res.send(result);
})

//delete apis
app.delete('/equipments/:id', async(req, res) =>{
   const id = req.params.id;
   const queary = {_id: new ObjectId(id)};
   const result = await equipments.deleteOne(queary);
   res.send(result);
})

app.listen(port, () => {
          console.log(`rent gear is running on port ${port}`)
})