require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error(
    "Missing MONGODB_URI. Please set it in .env or Render Environment Variables."
  );
  process.exit(1);
}

/* ===================== MONGODB CONNECT ===================== */

mongoose
  .connect(MONGODB_URI, {
    dbName: "tripmate",
  })
  .then(() => console.log("MongoDB connected successfully!"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

/* ============================================================
   TRIPMATE APP
   Collaborative Travel Planner + Suggestion + Checklist
   ============================================================ */

/* ===================== TRIP SCHEMAS ===================== */

const ChecklistItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    category: { type: String, default: "General" },
    done: { type: Boolean, default: false },
    assignedTo: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    updatedAt: { type: Number, default: Date.now },
  },
  { _id: true }
);

const PlaceSchema = new mongoose.Schema(
  {
    name: String,
    type: String,
    reason: String,
    estimatedCost: String,
    address: String,
    latitude: Number,
    longitude: Number,
  },
  { _id: false }
);

const RatingSchema = new mongoose.Schema(
  {
    placeName: String,
    userId: String,
    score: { type: Number, min: 1, max: 5 },
    comment: String,
    createdAt: { type: Number, default: Date.now },
  },
  { _id: true }
);

const LocationReminderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, default: "" },

    locationName: { type: String, default: "" },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    radiusMeters: { type: Number, default: 200 },

    enabled: { type: Boolean, default: true },
    triggered: { type: Boolean, default: false },

    createdBy: { type: String, default: "" },
    triggeredBy: { type: String, default: "" },

    createdAt: { type: Number, default: Date.now },
    triggeredAt: Number,
    updatedAt: { type: Number, default: Date.now },
  },
  { _id: true }
);

const TripSchema = new mongoose.Schema({
  destination: { type: String, required: true },
  title: { type: String, required: true },

  ownerId: { type: String, required: true },
  members: { type: [String], default: [] },

  note: { type: String, default: "" },
  status: { type: String, default: "planning" },
  tags: { type: [String], default: ["Travel"] },

  places: { type: [PlaceSchema], default: [] },
  foods: { type: [PlaceSchema], default: [] },
  checklist: { type: [ChecklistItemSchema], default: [] },
  ratings: { type: [RatingSchema], default: [] },

  locationReminders: { type: [LocationReminderSchema], default: [] },

  reminderTitle: String,
  latitude: Number,
  longitude: Number,
  locationName: String,

  updatedBy: String,
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
});

const Trip = mongoose.model("Trip", TripSchema);

/* ===================== SIMPLE AUTH SCHEMA ===================== */

const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  displayName: { type: String, default: "" },
  password: { type: String, required: true },
  avatarColor: { type: String, default: "#1E88E5" },
  createdAt: { type: Number, default: Date.now },
  lastLoginAt: Number,
});

const User = mongoose.model("User", UserSchema);

/* ===================== MOCK RECOMMENDATION DATA ===================== */

const recommendationData = {
  "vũng tàu": {
    destination: "Vũng Tàu",
    intro:
      "Trip biển ngắn ngày, phù hợp đi cuối tuần, ăn hải sản và check-in ven biển.",
    places: [
      {
        name: "Bãi Sau",
        type: "beach",
        reason: "Bãi biển phổ biến, dễ tắm biển và đi dạo buổi chiều.",
        estimatedCost: "Free",
      },
      {
        name: "Tượng Chúa Kitô Vua",
        type: "landmark",
        reason: "Điểm check-in nổi tiếng, có thể nhìn toàn cảnh thành phố.",
        estimatedCost: "Free",
      },
      {
        name: "Mũi Nghinh Phong",
        type: "landmark",
        reason: "View biển đẹp, hợp chụp ảnh nhóm.",
        estimatedCost: "Free",
      },
      {
        name: "Ngọn hải đăng Vũng Tàu",
        type: "landmark",
        reason: "Đường lên đẹp, ngắm thành phố từ trên cao.",
        estimatedCost: "Free",
      },
    ],
    foods: [
      {
        name: "Bánh khọt",
        type: "food",
        reason: "Món đặc trưng nên thử khi tới Vũng Tàu.",
        estimatedCost: "50k - 100k/người",
      },
      {
        name: "Hải sản",
        type: "food",
        reason: "Phù hợp ăn nhóm sau khi đi biển.",
        estimatedCost: "150k - 300k/người",
      },
      {
        name: "Lẩu cá đuối",
        type: "food",
        reason: "Món tối phổ biến, dễ ăn theo nhóm.",
        estimatedCost: "100k - 200k/người",
      },
    ],
    checklist: [
      { text: "Mua nước uống", category: "Shopping" },
      { text: "Mua snack / đồ ăn nhẹ", category: "Shopping" },
      { text: "Chuẩn bị kem chống nắng", category: "Personal" },
      { text: "Mang sạc dự phòng", category: "Personal" },
      { text: "Kiểm tra vé xe / lịch chạy xe", category: "Transport" },
      { text: "Đặt khách sạn hoặc homestay", category: "Hotel" },
      { text: "Lưu địa chỉ quán ăn muốn thử", category: "Food" },
    ],
  },

  "đà lạt": {
    destination: "Đà Lạt",
    intro: "Trip nghỉ dưỡng, cafe, chụp ảnh và ăn uống trong thời tiết se lạnh.",
    places: [
      {
        name: "Hồ Xuân Hương",
        type: "landmark",
        reason: "Dễ đi dạo, nằm ở trung tâm.",
        estimatedCost: "Free",
      },
      {
        name: "Quảng trường Lâm Viên",
        type: "landmark",
        reason: "Biểu tượng Đà Lạt, tiện check-in.",
        estimatedCost: "Free",
      },
      {
        name: "Chợ Đà Lạt",
        type: "shopping",
        reason: "Ăn vặt và mua quà.",
        estimatedCost: "50k - 200k/người",
      },
      {
        name: "Kombi Land",
        type: "cafe",
        reason: "Không gian chụp ảnh đẹp.",
        estimatedCost: "100k - 200k/người",
      },
    ],
    foods: [
      {
        name: "Bánh căn",
        type: "food",
        reason: "Món sáng phổ biến ở Đà Lạt.",
        estimatedCost: "40k - 80k/người",
      },
      {
        name: "Lẩu gà lá é",
        type: "food",
        reason: "Hợp thời tiết lạnh, ăn nhóm tốt.",
        estimatedCost: "100k - 200k/người",
      },
      {
        name: "Sữa đậu nành nóng",
        type: "food",
        reason: "Trải nghiệm tối đặc trưng.",
        estimatedCost: "20k - 50k/người",
      },
    ],
    checklist: [
      { text: "Chuẩn bị áo khoác", category: "Personal" },
      { text: "Đặt phòng trước", category: "Hotel" },
      { text: "Mang thuốc say xe", category: "Personal" },
      { text: "Lưu địa điểm thuê xe máy", category: "Transport" },
      { text: "Chuẩn bị pin dự phòng", category: "Personal" },
      { text: "Lên lịch các quán cafe muốn đi", category: "Food" },
    ],
  },

  "nha trang": {
    destination: "Nha Trang",
    intro: "Trip biển, đảo, hải sản và hoạt động ngoài trời.",
    places: [
      {
        name: "Bãi biển Nha Trang",
        type: "beach",
        reason: "Dễ đi, phù hợp tắm biển và đi dạo.",
        estimatedCost: "Free",
      },
      {
        name: "VinWonders Nha Trang",
        type: "landmark",
        reason: "Khu vui chơi lớn, phù hợp đi nhóm.",
        estimatedCost: "500k - 900k/người",
      },
      {
        name: "Tháp Bà Ponagar",
        type: "landmark",
        reason: "Địa điểm văn hóa nổi tiếng.",
        estimatedCost: "30k - 50k/người",
      },
    ],
    foods: [
      {
        name: "Bún cá Nha Trang",
        type: "food",
        reason: "Món địa phương dễ ăn.",
        estimatedCost: "40k - 80k/người",
      },
      {
        name: "Hải sản",
        type: "food",
        reason: "Phù hợp ăn tối theo nhóm.",
        estimatedCost: "150k - 300k/người",
      },
    ],
    checklist: [
      { text: "Chuẩn bị đồ bơi", category: "Personal" },
      { text: "Mua kem chống nắng", category: "Shopping" },
      { text: "Đặt khách sạn gần biển", category: "Hotel" },
      { text: "Kiểm tra vé máy bay / vé xe", category: "Transport" },
      { text: "Mang túi chống nước", category: "Personal" },
    ],
  },
};

/* ===================== RECOMMENDATION HELPERS ===================== */

function normalizeDestination(value = "") {
  return value.trim().toLowerCase();
}

function buildFallbackRecommendation(destination) {
  return {
    destination,
    intro: `Gợi ý nhanh cho chuyến đi ${destination}. Sau này có thể thay bằng ChatGPT API hoặc recommendation engine.`,
    places: [
      {
        name: `Trung tâm ${destination}`,
        type: "landmark",
        reason: "Điểm bắt đầu dễ tìm và thuận tiện.",
        estimatedCost: "Free",
      },
      {
        name: `Chợ / khu ăn uống ở ${destination}`,
        type: "food",
        reason: "Dễ tìm món địa phương.",
        estimatedCost: "50k - 200k/người",
      },
      {
        name: `Địa điểm check-in nổi bật tại ${destination}`,
        type: "landmark",
        reason: "Phù hợp đi nhóm và chụp ảnh.",
        estimatedCost: "Free - 100k",
      },
    ],
    foods: [
      {
        name: "Món địa phương nổi bật",
        type: "food",
        reason: "Nên thử để có trải nghiệm địa phương.",
        estimatedCost: "50k - 150k/người",
      },
      {
        name: "Quán cafe gần trung tâm",
        type: "cafe",
        reason: "Phù hợp nghỉ chân và họp nhóm.",
        estimatedCost: "40k - 100k/người",
      },
    ],
    checklist: [
      { text: "Kiểm tra phương tiện di chuyển", category: "Transport" },
      { text: "Đặt chỗ ở nếu đi qua đêm", category: "Hotel" },
      { text: "Chuẩn bị giấy tờ cá nhân", category: "Personal" },
      { text: "Mua nước uống và snack", category: "Shopping" },
      { text: "Lưu các địa điểm muốn đi", category: "General" },
    ],
  };
}

function getRecommendation(destination) {
  const key = normalizeDestination(destination);
  return recommendationData[key] || buildFallbackRecommendation(destination);
}

/* ===================== HEALTH CHECK ===================== */

app.get("/", (req, res) => {
  res.json({
    app: "TripMate Backend",
    status: "running",
    message: "Use /health, /suggestions, /trips APIs",
  });
});

app.get("/health", (req, res) => {
  res.json({
    app: "TripMate",
    status: "ok",
    time: Date.now(),
  });
});

/* ===================== SUGGESTIONS API ===================== */

app.get("/suggestions", (req, res) => {
  const destination = req.query.destination || "";

  if (!destination.trim()) {
    return res.status(400).json({
      message: "destination is required",
    });
  }

  const suggestion = getRecommendation(destination);
  res.json(suggestion);
});

/* ===================== SIMPLE AUTH APIs ===================== */

// POST /auth/signup
app.post("/auth/signup", async (req, res) => {
  try {
    const { userId, displayName = "", password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        message: "userId and password are required",
      });
    }

    const normalizedUserId = userId.trim();

    const existingUser = await User.findOne({
      userId: normalizedUserId,
    });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists",
      });
    }

    const user = new User({
      userId: normalizedUserId,
      displayName: displayName || normalizedUserId,
      password,
      createdAt: Date.now(),
    });

    await user.save();

    res.status(201).json({
      message: "Signup successful",
      user: {
        userId: user.userId,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

// POST /auth/login
app.post("/auth/login", async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        message: "userId and password are required",
      });
    }

    const user = await User.findOne({
      userId: userId.trim(),
    });

    if (!user || user.password !== password) {
      return res.status(401).json({
        message: "Invalid userId or password",
      });
    }

    user.lastLoginAt = Date.now();
    await user.save();

    res.json({
      message: "Login successful",
      user: {
        userId: user.userId,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

// GET /users
app.get("/users", async (req, res) => {
  try {
    const users = await User.find()
      .select("userId displayName avatarColor createdAt lastLoginAt")
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== TRIP APIs ===================== */

app.post("/trips/from-suggestion", async (req, res) => {
  try {
    const { destination, userId, title, memberIds = [], note = "" } = req.body;

    if (!destination || !userId) {
      return res.status(400).json({
        message: "destination and userId are required",
      });
    }

    const suggestion = getRecommendation(destination);

    const trip = new Trip({
      destination: suggestion.destination,
      title: title || `Trip to ${suggestion.destination}`,
      ownerId: userId,
      members: [...new Set(memberIds)],
      note: note || suggestion.intro,
      places: suggestion.places,
      foods: suggestion.foods,
      checklist: suggestion.checklist.map((item) => ({
        text: item.text,
        category: item.category,
        done: false,
        assignedTo: "",
        updatedBy: userId,
        updatedAt: Date.now(),
      })),
      updatedBy: userId,
      updatedAt: Date.now(),
    });

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/trips", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const trips = await Trip.find({
      $or: [{ ownerId: userId }, { members: userId }],
    }).sort({ updatedAt: -1 });

    res.json(trips);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/trips/:id", async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.put("/trips/:id", async (req, res) => {
  try {
    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        updatedAt: Date.now(),
      },
      { new: true }
    );

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id", async (req, res) => {
  try {
    const deleted = await Trip.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json({
      message: "Trip deleted",
      id: req.params.id,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== MOCK SHARING API ===================== */

app.post("/trips/:id/share", async (req, res) => {
  try {
    const { targetUserId, fromUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        message: "targetUserId is required",
      });
    }

    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      {
        $addToSet: { members: targetUserId },
        updatedBy: fromUserId || "system",
        updatedAt: Date.now(),
      },
      { new: true }
    );

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json({
      message: "Shared successfully",
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== COLLABORATIVE CHECKLIST APIs ===================== */

app.post("/trips/:id/checklist", async (req, res) => {
  try {
    const { text, category = "General", assignedTo = "", userId = "" } = req.body;

    if (!text) {
      return res.status(400).json({
        message: "text is required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    trip.checklist.push({
      text,
      category,
      assignedTo,
      updatedBy: userId,
      updatedAt: Date.now(),
    });

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/checklist/:itemId", async (req, res) => {
  try {
    const { done, assignedTo, userId = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const item = trip.checklist.id(req.params.itemId);

    if (!item) {
      return res.status(404).json({
        message: "Checklist item not found",
      });
    }

    if (typeof done === "boolean") item.done = done;
    if (assignedTo !== undefined) item.assignedTo = assignedTo;

    item.updatedBy = userId;
    item.updatedAt = Date.now();

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id/checklist/:itemId", async (req, res) => {
  try {
    const { userId = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const item = trip.checklist.id(req.params.itemId);

    if (!item) {
      return res.status(404).json({
        message: "Checklist item not found",
      });
    }

    item.deleteOne();

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ============================================================
   LOCATION REMINDER APIs
   ============================================================ */

app.patch("/trips/:id/location-reminder", async (req, res) => {
  try {
    const {
      reminderTitle,
      latitude,
      longitude,
      locationName,
      userId = "",
    } = req.body;

    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      {
        reminderTitle,
        latitude,
        longitude,
        locationName,
        updatedBy: userId,
        updatedAt: Date.now(),
      },
      { new: true }
    );

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trips/:id/location-reminders", async (req, res) => {
  try {
    const {
      title,
      message = "",
      locationName = "",
      latitude,
      longitude,
      radiusMeters = 200,
      userId = "",
    } = req.body;

    if (!title || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: "title, latitude and longitude are required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    trip.locationReminders.push({
      title,
      message,
      locationName,
      latitude,
      longitude,
      radiusMeters,
      enabled: true,
      triggered: false,
      createdBy: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    const createdReminder =
      trip.locationReminders[trip.locationReminders.length - 1];

    res.status(201).json({
      message: "Location reminder created",
      reminder: createdReminder,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/trips/:id/location-reminders", async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json(trip.locationReminders || []);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/users/:userId/location-reminders", async (req, res) => {
  try {
    const userId = req.params.userId;

    const trips = await Trip.find({
      $or: [{ ownerId: userId }, { members: userId }],
    }).sort({ updatedAt: -1 });

    const reminders = [];

    trips.forEach((trip) => {
      (trip.locationReminders || []).forEach((reminder) => {
        if (reminder.enabled && !reminder.triggered) {
          reminders.push({
            tripId: trip._id,
            tripTitle: trip.title,
            destination: trip.destination,
            reminder,
          });
        }
      });
    });

    res.json(reminders);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/location-reminders/:reminderId", async (req, res) => {
  try {
    const {
      title,
      message,
      locationName,
      latitude,
      longitude,
      radiusMeters,
      enabled,
      userId = "",
    } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    if (title !== undefined) reminder.title = title;
    if (message !== undefined) reminder.message = message;
    if (locationName !== undefined) reminder.locationName = locationName;
    if (latitude !== undefined) reminder.latitude = latitude;
    if (longitude !== undefined) reminder.longitude = longitude;
    if (radiusMeters !== undefined) reminder.radiusMeters = radiusMeters;
    if (typeof enabled === "boolean") reminder.enabled = enabled;

    reminder.updatedAt = Date.now();

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.json({
      message: "Location reminder updated",
      reminder,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/location-reminders/:reminderId/trigger", async (req, res) => {
  try {
    const { userId = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    reminder.triggered = true;
    reminder.triggeredBy = userId;
    reminder.triggeredAt = Date.now();
    reminder.updatedAt = Date.now();

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.json({
      message: "Location reminder triggered",
      reminder,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/location-reminders/:reminderId/reset", async (req, res) => {
  try {
    const { userId = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    reminder.triggered = false;
    reminder.triggeredBy = "";
    reminder.triggeredAt = undefined;
    reminder.enabled = true;
    reminder.updatedAt = Date.now();

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.json({
      message: "Location reminder reset",
      reminder,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id/location-reminders/:reminderId", async (req, res) => {
  try {
    const { userId = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    reminder.deleteOne();

    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.json({
      message: "Location reminder deleted",
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== RATINGS / DATA COLLECTION APIs ===================== */

app.post("/trips/:id/ratings", async (req, res) => {
  try {
    const { placeName, userId, score, comment = "" } = req.body;

    if (!placeName || !userId || !score) {
      return res.status(400).json({
        message: "placeName, userId and score are required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    trip.ratings.push({
      placeName,
      userId,
      score,
      comment,
      createdAt: Date.now(),
    });

    trip.status = "finished";
    trip.updatedBy = userId;
    trip.updatedAt = Date.now();

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/ratings/summary", async (req, res) => {
  try {
    const result = await Trip.aggregate([
      { $unwind: "$ratings" },
      {
        $group: {
          _id: "$ratings.placeName",
          averageScore: { $avg: "$ratings.score" },
          totalReviews: { $sum: 1 },
        },
      },
      {
        $sort: {
          averageScore: -1,
          totalReviews: -1,
        },
      },
    ]);

    res.json(result);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ============================================================
   LEGACY NOTE APP APIs
   ============================================================ */

const NoteSchema = new mongoose.Schema({
  title: String,
  content: String,

  ownerId: String,
  sharedWith: [String],

  updatedBy: String,
  updatedAt: Number,

  latitude: Number,
  longitude: Number,
  locationName: String,
});

const Note = mongoose.model("Note", NoteSchema);

const ShareRequestSchema = new mongoose.Schema({
  noteId: String,
  fromUserId: String,
  toUserId: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Number, default: Date.now },
});

const ShareRequest = mongoose.model("ShareRequest", ShareRequestSchema);

app.get("/notes", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const notes = await Note.find({
      $or: [{ ownerId: userId }, { sharedWith: userId }],
    }).sort({ updatedAt: -1 });

    res.json(notes);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/notes", async (req, res) => {
  try {
    const note = new Note({
      ...req.body,
      updatedAt: Date.now(),
    });

    await note.save();

    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.put("/notes/:id", async (req, res) => {
  try {
    const note = await Note.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        updatedAt: Date.now(),
      },
      { new: true }
    );

    if (!note) {
      return res.status(404).json({
        message: "Note not found",
      });
    }

    res.json(note);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.delete("/notes/:id", async (req, res) => {
  try {
    const deleted = await Note.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        message: "Note not found",
      });
    }

    res.json({
      message: "Note deleted",
      id: req.params.id,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/share-request", async (req, res) => {
  try {
    const { noteId, fromUserId, toUserId } = req.body;

    if (!noteId || !fromUserId || !toUserId) {
      return res.status(400).json({
        message: "noteId, fromUserId and toUserId are required",
      });
    }

    const request = new ShareRequest({
      noteId,
      fromUserId,
      toUserId,
      status: "pending",
      createdAt: Date.now(),
    });

    await request.save();

    res.json({
      message: "Request sent",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/share-request", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const requests = await ShareRequest.find({
      toUserId: userId,
      status: "pending",
    }).sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/share-request/accept", async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({
        message: "requestId is required",
      });
    }

    const request = await ShareRequest.findById(requestId);

    if (!request) {
      return res.status(404).json({
        message: "Share request not found",
      });
    }

    await Note.findByIdAndUpdate(request.noteId, {
      $addToSet: { sharedWith: request.toUserId },
      updatedAt: Date.now(),
      updatedBy: request.toUserId,
    });

    request.status = "accepted";
    await request.save();

    res.json({
      message: "Accepted",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/share-request/reject", async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({
        message: "requestId is required",
      });
    }

    const request = await ShareRequest.findByIdAndUpdate(
      requestId,
      {
        status: "rejected",
      },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({
        message: "Share request not found",
      });
    }

    res.json({
      message: "Rejected",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== START SERVER ===================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TripMate backend running on http://0.0.0.0:${PORT}`);
});