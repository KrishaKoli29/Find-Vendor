// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');

const app = express();
const server = http.createServer(app);

// Configure CORS to allow your frontend to connect
const io = new Server(server, {
    cors: {
        origin: "*", // In production, restrict this to your Vercel URL
        methods: ["GET", "POST"]
    }
});

// Initialize Redis Client
const redisClient = createClient({
    url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().then(() => console.log('Connected to Redis'));

const VENDOR_GEO_KEY = 'vendor_locations';

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- VENDOR LOGIC ---
    socket.on('vendorOnline', async (data) => {
        const { lat, lng, name, items } = data;
        
        // Store coordinates in Redis Geospatial index
        await redisClient.geoAdd(VENDOR_GEO_KEY, {
            longitude: lng,
            latitude: lat,
            member: socket.id
        });

        // Store vendor metadata in a Redis Hash
        await redisClient.hSet(`vendor:${socket.id}`, {
            name: name,
            items: items,
            lat: lat.toString(),
            lng: lng.toString()
        });
        
        console.log(`Vendor ${name} went online.`);
    });

    socket.on('vendorLocationUpdate', async (data) => {
        const { lat, lng } = data;
        // Update coordinates in the Geospatial index
        await redisClient.geoAdd(VENDOR_GEO_KEY, {
            longitude: lng,
            latitude: lat,
            member: socket.id
        });
        await redisClient.hSet(`vendor:${socket.id}`, { lat: lat.toString(), lng: lng.toString() });
    });

    socket.on('vendorOffline', async () => {
        await removeVendor(socket.id);
    });

    socket.on('disconnect', async () => {
        await removeVendor(socket.id);
        console.log(`User disconnected: ${socket.id}`);
    });

    // --- CUSTOMER LOGIC ---
    socket.on('requestNearbyVendors', async (customerLocation) => {
        const { lat, lng } = customerLocation;
        
        try {
            // Find all vendors within a 5km radius using Redis GEOSEARCH
            const nearbyVendorIds = await redisClient.geoSearch(
                VENDOR_GEO_KEY,
                { longitude: lng, latitude: lat },
                { radius: 5, unit: 'km' }
            );

            // Fetch metadata for each nearby vendor
            const activeVendors = [];
            for (const id of nearbyVendorIds) {
                const vendorData = await redisClient.hGetAll(`vendor:${id}`);
                if (Object.keys(vendorData).length > 0) {
                    activeVendors.push({ id, ...vendorData });
                }
            }

            // Send optimized list back to the specific customer
            socket.emit('nearbyVendorsUpdate', activeVendors);
        } catch (error) {
            console.error("Error fetching nearby vendors", error);
        }
    });

    // Helper to cleanup Redis when a vendor leaves
    async function removeVendor(id) {
        await redisClient.zRem(VENDOR_GEO_KEY, id);
        await redisClient.del(`vendor:${id}`);
        // Broadcast to all clients to remove this marker
        io.emit('vendorDisconnected', id); 
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WanderCart Backend running on port ${PORT}`);
});