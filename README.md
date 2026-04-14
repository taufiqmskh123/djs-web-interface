# 🐅 Wild Horizon: Tactical Safari Management System

**Wild Horizon** is an advanced IoT-driven ecosystem designed for autonomous wildlife monitoring and safari management. By integrating embedded systems, real-time cloud synchronization, and computer vision, the system provides forest rangers with a **"Digital Twin"** of the field bot, offering live telemetry, automated mission logging, and AI-powered animal geolocation.

---

## 🚀 Key Features

* **Tactical Mission Control:** A high-contrast, low-light optimized dashboard designed specifically for field research and forest ranger environments.
* **Precision Telemetry:** Real-time tracking of Latitude and Longitude with a dynamic, high-frequency **"Breadcrumb"** path-drawing system.
* **Automated Lap Timer:** A high-precision mission clock that triggers via movement flags and stops instantly upon RFID-based checkpoint arrival.
* **AI Sightings Log:** Seamless integration with **OpenCV** to geolocate and timestamp wildlife detections (Lion, Tiger, Giraffe, etc.) directly on the tactical map.
* **Automated Reporting:** Generates a structured, human-readable mission brief upon completion, summarizing total distance, speed, and wildlife encounters.

---

## 🛠️ Tech Stack

### **Frontend & Dashboard**
* **Next.js 14:** High-performance React framework for a seamless, fast-loading interface.
* **Tailwind CSS:** Custom tactical design system featuring glassmorphism and earth-tone aesthetics.
* **Lucide React:** Industrial-grade iconography for professional UI.
* **HTML5 Canvas:** Utilized for real-time, high-frequency rendering of the bot's path.

### **Backend & Cloud**
* **Firebase Realtime Database:** Low-latency NoSQL cloud storage for instantaneous data synchronization.

### **Hardware & Vision**
* **ESP32:** Core microcontroller managing sensor data and HTTP communication.
* **GPS Module:** Provides accurate geospatial coordinates for real-time tracking.
* **MFRC522 RFID Sensor:** Used for precise mission "finish-line" and checkpoint detection.
* **OpenCV:** Python-based computer vision for real-time wildlife classification.

---

## ⚙️ How It Works

### 1. Data Acquisition (The Bot)
The **ESP32** acts as the primary data node. It polls the GPS module for coordinates and monitors the RFID sensor. The moment the bot initiates movement, it pushes an `isMoving: true` flag to the cloud to arm the mission clock.

### 2. Real-Time Synchronization
Data is transmitted via **HTTP PATCH** requests to the Firebase Realtime Database. This ensures the dashboard updates in under **200ms**, providing a "live" mission control experience.

### 3. Intelligence Layer (OpenCV)
A parallel computer vision stream processes live imagery. When an animal is identified, the name is pushed to the `detectedAnimal` node. The dashboard automatically "stamps" the current GPS coordinates with a corresponding emoji icon (e.g., 🦁) on the map.

### 4. Mission Conclusion
When the bot scans the designated RFID tag, the `rfidReached` flag is set to `true`. This freezes the mission clock and triggers the **Mission Summary Modal**, compiling all telemetry data into a downloadable and organized report.

---

## 📁 Project Structure

```plaintext
├── app/
│   ├── page.tsx          # Main Tactical Dashboard & Landing Page logic
│   ├── layout.tsx        # Global theme and font configuration
│   └── globals.css       # Custom Safari-theme CSS and animations
├── public/               # Asset storage (icons, topographic textures)
└── lib/                  # Firebase configuration and helper functions
