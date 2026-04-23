const mongoose = require('mongoose');
const { User } = require('./db/models.js');

mongoose.connect('mongodb://127.0.0.1:27017/tim_cloud_test').then(async () => {
    // Drop test DB
    await mongoose.connection.dropDatabase();
    
    // Create new user without providing config
    const newUser = new User({ username: 'testuser123', password: 'abc', email: 'test12345@test.com' });
    await newUser.save();
    
    // Find the user
    const fetched = await User.findOne({ username: 'testuser123' });
    console.log("Config object:", fetched.config);
    if (!fetched.config) {
        console.log("CRITICAL: user.config is undefined!");
    } else {
        console.log("Config phoneId:", fetched.config.phoneId);
    }
    
    mongoose.disconnect();
});
