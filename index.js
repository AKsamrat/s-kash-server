const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const config = process.env;
const PORT = process.env.PORT || 5000;
const app = express();
const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET || 'your_jwt_secret';
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nj7eiar.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
console.log(uri);

const corsConfig = {
  origin: [
    'http://localhost:5173',
    // 'http://localhost:5174',
  ],
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(cors(corsConfig));
app.use(express.json());
app.use(cookieParser());

// verify token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  console.log('39:', req.cookies);

  console.log('token console from 40', token);
  if (!token) return res.status(401).send({ message: 'Un Authorize' });
  if (token) {
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).send({ message: 'Un Authorize' });
      }
      console.log('decode 47', decoded);
      req.user = decoded;
      next();
    });
  }
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    //database collections are here
    const database = client.db('sKash');
    const userCollection = database.collection('users');
    const transactionCollection = database.collection('transaction');
    const requestCollection = database.collection('request');

    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1d',
      });
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true });
    });
    app.post('/logout', async (req, res) => {
      const user = req.body;
      console.log('logged out', user);
      res.clearCookie('token', { maxAge: 0 }).send({ success: true });
    });

    //user registration
    // app.post('/register', async (req, res) => {
    //   const user = req.body;
    //   const query = { email: user?.email };
    //   //check if user already have

    //   const isExist = await userCollection.findOne(query);
    //   if (isExist) {
    //     return;
    //   }
    //   const option = { upsert: true };
    //   const updateDoc = {
    //     $set: {
    //       ...user,
    //       timestamp: Date.now(),
    //     },
    //   };
    //   const result = await userCollection.updateOne(query, updateDoc, option);

    //   res.send(result);
    // });
    app.post('/register', async (req, res) => {
      const { username, email, password, image_url, mobileNo, role } = req.body;
      try {
        const user = await userCollection.findOne({ email });
        if (user) {
          return res.status(400).json({ message: 'User already exists' });
        }
        console.log('login');

        const hashedPassword = await bcrypt.hash(password, 10);
        await userCollection.insertOne({
          username,
          password: hashedPassword,
          email,
          image_url,
          mobileNo,
          role,
          status: 'pending',
          timestamp: Date.now(),
          balance: 0,
        });

        res
          .status(201)
          .json({ success: true, message: 'User registered successfully' });
      } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    //login user
    app.post('/login', async (req, res) => {
      const { email, password } = req.body;
      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.send({ success: false, message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        console.log(isMatch);

        if (!isMatch) {
          return res.send({ success: false, message: 'Invalid credentials' });
        }

        const { password: pass, ...rest } = user;
        const token = jwt.sign({ ...rest }, JWT_SECRET, { expiresIn: '1h' });
        res.send({ token, success: true, message: 'Successfully Logged In' });
      } catch (error) {
        res.send({ message: 'Internal server error' });
      }
    });

    // user activity ===============================.......

    //send Money=======>>>>>>>>>>>>>>>>>>>>>>

    app.post('/send-Money', async (req, res) => {
      const transactionData = req.body;
      const user = await userCollection.findOne({
        mobileNo: transactionData.mobileNo,
      });
      const sender = await userCollection.findOne({
        email: transactionData.senderEmail,
      });
      if (user.role !== 'user') {
        return res.send({ success: false, message: 'Receiver is not a User' });
      }

      // console.log(sender);
      if (!user) {
        return res.send({ success: false, message: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(
        transactionData.password,
        sender.password
      );

      if (!isMatch) {
        return res.send({ success: false, message: 'Invalid credentials' });
      }
      const updateBalance = parseInt(
        user.balance + transactionData.totalAmount
      );
      const sUpdateBalance = parseInt(
        sender.balance - transactionData.totalAmount
      );
      // console.log(transactionData?.totalAmount, updateBalance);
      const senderUpdateBalance = {
        $set: { balance: sUpdateBalance },
      };
      const updateData = {
        $set: {
          balance: updateBalance,
          receiverEmail: user.email,
        },
      };
      const transData = {
        ...transactionData,
        receiverEmail: user.email,
      };
      const id = transactionData._id;
      const query = { mobileNo: transactionData.mobileNo };
      const receiverBalance = await userCollection.updateOne(query, updateData);
      const senderBalance = await userCollection.updateOne(
        { email: transactionData.senderEmail },
        senderUpdateBalance
      );
      const result = await transactionCollection.insertOne(transData);
      res.send(result);
    });

    //Cash out ==============>>>>>>>>>>>>>>>>>>>>>>>>>>

    app.post('/cash-out', async (req, res) => {
      const transactionData = req.body;
      const user = await userCollection.findOne({
        mobileNo: transactionData.mobileNo,
      });
      const sender = await userCollection.findOne({
        email: transactionData.senderEmail,
      });
      if (user.role !== 'Agent') {
        return res.send({ success: false, message: 'Receiver is not a Agent' });
      }

      // console.log(sender);
      if (!user) {
        return res.send({ success: false, message: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(
        transactionData.password,
        sender.password
      );

      if (!isMatch) {
        return res.send({ success: false, message: 'Invalid credentials' });
      }
      const transData = {
        ...transactionData,
        receiverEmail: user.email,
      };
      const result = await requestCollection.insertOne(transData);
      res.send(result);
    });

    //cash -in

    app.post('/cash-in', async (req, res) => {
      const transactionData = req.body;
      const user = await userCollection.findOne({
        mobileNo: transactionData.mobileNo,
      });
      const sender = await userCollection.findOne({
        email: transactionData.senderEmail,
      });
      if (user.role !== 'Agent') {
        return res.send({
          success: false,
          message: 'Receiver is not a Agent',
        });
      }

      // console.log(sender);
      if (!user) {
        return res.send({ success: false, message: 'Invalid credentials' });
      }

      const transData = {
        ...transactionData,
        receiverEmail: user.email,
      };
      const result = await requestCollection.insertOne(transData);
      res.send(result);
    });

    //agent transaction-management=======>>>>>>>>>>>>>>>>>
    app.get('/transaction-management/:email', async (req, res) => {
      const email = req.params.email;
      const query = {
        receiverEmail: email,
      };
      // console.log(query);
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

    //reject request from agent ==================>>>>>>>>>>>>>
    app.delete('/reject-request/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestCollection.deleteOne(query);
      res.send(result);
    });

    //approve request of cash in and cash out

    app.patch('/approve-request/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const reqData = await requestCollection.findOne(query);
      const senderData = await userCollection.findOne({
        email: reqData.senderEmail,
      });
      const receiverData = await userCollection.findOne({
        email: reqData.receiverEmail,
      });
      console.log(senderData, receiverData);

      //checking request type

      if (reqData.type === 'Cash Out') {
        const rUpdateBalance = parseInt(
          receiverData.balance + reqData.totalAmount
        );
        const sUpdateBalance = parseInt(
          senderData.balance - reqData.totalAmount
        );
        // console.log(transactionData?.totalAmount, updateBalance);
        const senderUpdateBalance = {
          $set: { balance: sUpdateBalance },
        };
        const updateData = {
          $set: {
            balance: rUpdateBalance,
          },
        };
        const query = { email: reqData.receiverEmail };
        const receiverBalance = await userCollection.updateOne(
          query,
          updateData
        );
        const senderBalance = await userCollection.updateOne(
          { email: reqData.senderEmail },
          senderUpdateBalance
        );
        const result = await transactionCollection.insertOne(reqData);
        res.send(result);
      } else {
        const rUpdateBalance = parseInt(
          receiverData.balance - reqData.totalAmount
        );
        const sUpdateBalance = parseInt(
          senderData.balance + reqData.totalAmount
        );
        // console.log(transactionData?.totalAmount, updateBalance);
        const senderUpdateBalance = {
          $set: { balance: sUpdateBalance },
        };
        const updateData = {
          $set: {
            balance: rUpdateBalance,
          },
        };
        const query = { email: reqData.receiverEmail };
        const receiverBalance = await userCollection.updateOne(
          query,
          updateData
        );
        const senderBalance = await userCollection.updateOne(
          { email: reqData.senderEmail },
          senderUpdateBalance
        );
        const result = await transactionCollection.insertOne(reqData);
        res.send(result);
      }
    });

    //balance inquiry ==================>>>>>>>>>>>>>

    app.get('/user-balance/:email', async (req, res) => {
      const email = req.params.email;

      const query = { email: email };
      // console.log(query);
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    //pagination----------------------

    //all jobs load
    app.get('/allJobs', async (req, res) => {
      const size = parseInt(req.query.size);
      const page = parseInt(req.query.page);
      const search = req.query.search;
      let query = {
        job_title: { $regex: search, $options: 'i' },
      };
      const result = await jobsCollection
        .find(query)
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });
    app.get('/allJob', async (req, res) => {
      const result = await jobsCollection.find().toArray();
      res.send(result);
    });

    //for myjobs data load-----------------------------------

    app.get('/myJobs/:email', async (req, res) => {
      const tokenEmail = req.user.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const query = { owner_email: email };
      console.log(query);
      const result = await jobsCollection.find(query).toArray();
      res.send(result);
    });

    //Add job  data in database

    app.post('/addJob', async (req, res) => {
      const jobData = req.body;
      const result = await jobsCollection.insertOne(jobData);
      res.send(result);
    });

    //for delete job item
  } finally {
  }
}
run().catch(console.dir);

// Connection

app.get('/', (req, res) => {
  res.send('YOUR server is live');
});
app.listen(PORT, () => {
  console.log(`App running in port:  ${PORT}`);
});
