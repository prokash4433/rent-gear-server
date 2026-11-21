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
const favourites = database.collection('favourites');

// User input diye regex bananor age special characters safe kore rakhe,
// jeno query torey na jay (regex validation).
function escapeRegex(text) {
   return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Query param ekta string, array, ba undefined hote pare -> ekta normal string.
function oneParam(value) {
   if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0].trim() : '';
   return typeof value === 'string' ? value.trim() : '';
}

// Ekadhik bar asha param (jemon category) -> string list.
function listParam(value) {
   const list = Array.isArray(value) ? value : value ? [value] : [];
   return list.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

// Notun form "construction" (key) pathay, kintu purano DB te
// "Construction Equipment" (label) lekha ache -> duto-i match korte hobe.
const categoryLabels = {
   agriculture: 'Agriculture Equipment',
   cleaning: 'Cleaning Equipment',
   construction: 'Construction Equipment',
   electronics: 'Electronics',
   events: 'Event Equipment',
   photography: 'Photography Equipment',
   vehicles: 'Vehicles & Transportation',
};

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
   try {
      // Prottek filter alada condition hisebe jome, shob diye final query toiri hobe.
      const conditions = [];

      // Search: name ba location er upore case-insensitive partial match.
      const search = oneParam(req.query.search).slice(0, 100);
      if (search) {
         const pattern = new RegExp(escapeRegex(search), 'i');
         conditions.push({ $or: [{ name: pattern }, { location: pattern }] });
      }

      // Category: ekadhik category ek sathe select kora jay.
      const categories = listParam(req.query.category);
      if (categories.length) {
         const patterns = categories
            .flatMap((key) => (categoryLabels[key] ? [key, categoryLabels[key]] : [key]))
            .map((value) => new RegExp(`^${escapeRegex(value)}$`, 'i'));
         conditions.push({ category: { $in: patterns } });
      }

      // Rental Type: Hourly / Daily / Weekly / Monthly.
      const rentalTypes = listParam(req.query.rentalType);
      if (rentalTypes.length) {
         conditions.push({
            rentalType: { $in: rentalTypes.map((value) => new RegExp(`^${escapeRegex(value)}$`, 'i')) },
         });
      }

      // Price range: rentalPrice string ("9") o number (9) duto-i ache,
      // tai number e convert kore compare korchi.
      const priceValue = { $toDouble: { $ifNull: ['$rentalPrice', '0'] } };
      const minPrice = oneParam(req.query.minPrice);
      const maxPrice = oneParam(req.query.maxPrice);
      if (minPrice !== '' && !Number.isNaN(Number(minPrice))) {
         conditions.push({ $expr: { $gte: [priceValue, Number(minPrice)] } });
      }
      if (maxPrice !== '' && !Number.isNaN(Number(maxPrice))) {
         conditions.push({ $expr: { $lte: [priceValue, Number(maxPrice)] } });
      }

      // Available only: quantity 0 er beshi holei available.
      if (oneParam(req.query.available) === 'true') {
         conditions.push({ $expr: { $gt: [{ $toDouble: { $ifNull: ['$quantity', '0'] } }, 0] } });
      }

      // Approved only: je purano document-e status field nei, tader approved.
      if (oneParam(req.query.status) === 'approved') {
         conditions.push({ $or: [{ status: 'approved' }, { status: { $exists: false } }] });
      }

      const filter = conditions.length ? { $and: conditions } : {};

      // Sort: price sort e aggregation lagbe, karon price mixed type.
      const sort = oneParam(req.query.sort);
      let cursor;
      if (sort === 'price-asc' || sort === 'price-desc') {
         cursor = equipments.aggregate([
            { $match: filter },
            { $addFields: { _price: { $toDouble: { $ifNull: ['$rentalPrice', '0'] } } } },
            { $sort: { _price: sort === 'price-asc' ? 1 : -1 } },
         ]);
      } else if (sort === 'newest') {
         // Notun document er _id boro -> _id descending mane notun age.
         cursor = equipments.find(filter).sort({ _id: -1 });
      } else {
         cursor = equipments.find(filter);
      }

      const result = await cursor.toArray();
      res.send(result);
   } catch (error) {
      console.error('GET /equipments failed:', error);
      res.status(500).send({ error: 'Could not load equipments' });
   }
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

//update 
app.patch('/equipments/:id', async (req, res) => {
   const id = req.params.id;
   const query = { _id: new ObjectId(id) };
   const { rentalPrice, quantity } = req.body;

   const updateDoc = {
      $set: {
         rentalPrice: Number(rentalPrice),
         quantity: Number(quantity),
      },
   };

   const result = await equipments.updateOne(query, updateDoc);
   res.send(result);
});


//favourite related apis
app.get('/favourites', async (req, res) => {
   try {
      const userEmail = oneParam(req.query.userEmail);
      if (!userEmail) {
         return res.status(400).send({ error: 'userEmail is required' });
      }
      const result = await favourites.find({ userEmail }).toArray();
      res.send(result);
   } catch (error) {
      console.error('GET /favourites failed:', error);
      res.status(500).send({ error: 'Could not load favourites' });
   }
});

app.post('/favourites', async (req, res) => {
   try {
      const { equipmentId, userEmail } = req.body;
      if (!equipmentId || !userEmail) {
         return res.status(400).send({ error: 'equipmentId and userEmail are required' });
      }
      // Ekjon user ekta equipment ek bar-i favourite korte pare.
      const existing = await favourites.findOne({ equipmentId, userEmail });
      if (existing) {
         return res.status(409).send({ error: 'Already in favourites' });
      }
      const result = await favourites.insertOne({ equipmentId, userEmail, createdAt: new Date() });
      res.send(result);
   } catch (error) {
      console.error('POST /favourites failed:', error);
      res.status(500).send({ error: 'Could not add favourite' });
   }
});

app.delete('/favourites', async (req, res) => {
   try {
      const { equipmentId, userEmail } = req.body;
      if (!equipmentId || !userEmail) {
         return res.status(400).send({ error: 'equipmentId and userEmail are required' });
      }
      const result = await favourites.deleteOne({ equipmentId, userEmail });
      res.send(result);
   } catch (error) {
      console.error('DELETE /favourites failed:', error);
      res.status(500).send({ error: 'Could not remove favourite' });
   }
});


app.listen(port, () => {
          console.log(`rent gear is running on port ${port}`)
})