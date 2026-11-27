import express from 'express';
import cors from 'cors'
import { ObjectId } from 'mongodb';
import 'dotenv/config'
import { connectToMongoDB, users, equipments, favourites } from './db.js';
import { verifyToken } from './middleware/verifyToken.js';
import { verifyRenter } from './middleware/verifyRenter.js';
import { verifyOwner } from './middleware/verifyOwner.js';
import { verifyAdmin } from './middleware/verifyAdmin.js';

const app = express();
const port = process.env.PORT || 5000;


//middleware
app.use(express.json());
app.use(cors());

// Re-exported so anything importing the old entrypoint keeps working
// (the connection itself now lives in db.js, shared with the auth middleware).
export { connectToMongoDB };

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

/**
 * Listing-er owner (ba admin) hole-i price/quantity/status change kora jabe.
 * JWT theke asha email diye document-er ownerEmail er sathe match kore.
 */
function canManageEquipment(user, equipment) {
   if (!user || !equipment) return false;
   if (user.role === 'admin') return true;
   const ownerEmail = typeof equipment.ownerEmail === 'string' ? equipment.ownerEmail.trim().toLowerCase() : '';
   return Boolean(ownerEmail) && ownerEmail === String(user.email ?? '').trim().toLowerCase();
}

app.get('/', (req, res) => {
          res.send('rent gear is gearing')
})

//user reated apis — admin only (JWT + role required).
app.get('/users', verifyAdmin, async(req, res)=>{
   try {
      const cursor = users.find({});
      const result = await cursor.toArray();
      res.send(result);
   } catch (error) {
      console.error('GET /users failed:', error);
      res.status(500).send({ error: 'Could not load users' });
   }
})


// Equipment catalogue — PUBLIC: the All Equipment page renders for
// signed-out visitors too, so listing reads need no JWT. Every write
// (POST/PATCH/DELETE) and the per-item details read stay protected below.
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

// Ekta nirdishto equipment er details (details page er jonno) — JWT required.
app.get('/equipments/:id', verifyToken, async (req, res) => {
   try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
         return res.status(400).send({ error: 'Invalid equipment id' });
      }
      const equipment = await equipments.findOne({ _id: new ObjectId(id) });
      if (!equipment) {
         return res.status(404).send({ error: 'Equipment not found' });
      }

      // Owner er naam dorkar (owner card dekhate).
      let ownerName = '';
      if (equipment.ownerEmail) {
         const owner = await users.findOne({ email: equipment.ownerEmail });
         ownerName = owner?.name || '';
      }

      res.send({ ...equipment, ownerName });
   } catch (error) {
      console.error('GET /equipments/:id failed:', error);
      res.status(500).send({ error: 'Could not load equipment' });
   }
});

// Notun listing — owner role lage, ar ownerEmail JWT er user-i thakbe
// (ake jonno onno kew listing korte parbe na).
app.post('/equipments', verifyOwner, async(req,res)=>{
   try {
      const equipmentData = { ...req.body, ownerEmail: req.user.email };
      const result = await equipments.insertOne(equipmentData);
      res.send(result);
   } catch (error) {
      console.error('POST /equipments failed:', error);
      res.status(500).send({ error: 'Could not create equipment' });
   }
})

//delete apis — nijer listing (ba admin) delete korte parbe.
app.delete('/equipments/:id', verifyToken, async(req, res)=>{
   try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
         return res.status(400).send({ error: 'Invalid equipment id' });
      }
      const equipment = await equipments.findOne({ _id: new ObjectId(id) });
      if (!equipment) {
         return res.status(404).send({ error: 'Equipment not found' });
      }
      if (!canManageEquipment(req.user, equipment)) {
         return res.status(403).send({
            error: 'Access denied: you can only delete your own equipment.',
            code: 'NOT_EQUIPMENT_OWNER',
         });
      }
      const result = await equipments.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
   } catch (error) {
      console.error('DELETE /equipments/:id failed:', error);
      res.status(500).send({ error: 'Could not delete equipment' });
   }
})

//update — nijer listing (ba admin) update korte parbe.
app.patch('/equipments/:id', verifyToken, async (req, res) => {
   try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
         return res.status(400).send({ error: 'Invalid equipment id' });
      }
      const equipment = await equipments.findOne({ _id: new ObjectId(id) });
      if (!equipment) {
         return res.status(404).send({ error: 'Equipment not found' });
      }
      if (!canManageEquipment(req.user, equipment)) {
         return res.status(403).send({
            error: 'Access denied: you can only update your own equipment.',
            code: 'NOT_EQUIPMENT_OWNER',
         });
      }

      // Status shudhu admin change korte parbe (approve / reject).
      const { rentalPrice, quantity, status } = req.body;
      if (status !== undefined && req.user.role !== 'admin') {
         return res.status(403).send({
            error: 'Access denied: only admins can change approval status.',
            code: 'INSUFFICIENT_ROLE',
         });
      }

      // Jeno undefined diye price/quantity NaN hoye na jay — field thaklei set.
      const updateDoc = {};
      if (rentalPrice !== undefined) updateDoc.rentalPrice = Number(rentalPrice);
      if (quantity !== undefined) updateDoc.quantity = Number(quantity);
      if (status !== undefined) updateDoc.status = status;
      updateDoc.updatedAt = new Date();

      if (Object.keys(updateDoc).length === 1) {
         return res.status(400).send({ error: 'No valid fields to update' });
      }

      const result = await equipments.updateOne({ _id: new ObjectId(id) }, { $set: updateDoc });
      res.send(result);
   } catch (error) {
      console.error('PATCH /equipments/:id failed:', error);
      res.status(500).send({ error: 'Could not update equipment' });
   }
});


//favourite related apis — renter (customer) role lage, nijei record.
app.get('/favourites', verifyRenter, async (req, res) => {
   try {
      const userEmail = oneParam(req.query.userEmail);
      if (!userEmail) {
         return res.status(400).send({ error: 'userEmail is required' });
      }
      if (userEmail.toLowerCase() !== String(req.user.email).toLowerCase()) {
         return res.status(403).send({
            error: 'Access denied: you can only read your own favourites.',
            code: 'NOT_YOUR_RECORD',
         });
      }
      const result = await favourites.find({ userEmail: req.user.email }).toArray();
      res.send(result);
   } catch (error) {
      console.error('GET /favourites failed:', error);
      res.status(500).send({ error: 'Could not load favourites' });
   }
});

app.post('/favourites', verifyRenter, async (req, res) => {
   try {
      const { equipmentId } = req.body;
      const userEmail = req.user.email;
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

app.delete('/favourites', verifyRenter, async (req, res) => {
   try {
      const { equipmentId } = req.body;
      const userEmail = req.user.email;
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
