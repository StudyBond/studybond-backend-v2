# StudyBond Backend

## Setup Instructions

### 1. Clone Repository
```bash
git clone https://github.com/YourUsername/studybond-backend.git
cd studybond-backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
```bash
# Copy template
cp .env.example .env

# Edit .env with your credentials:
# - Add YOUR PostgreSQL password
# - Generate JWT secret: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Set Up Database
```bash
# Make sure PostgreSQL is running
# Create database (if needed): createdb studybond

# Run migrations
npx prisma migrate dev
```

### 5. Start Development Server
```bash
npm run dev
```

Server should start at: http://localhost:5000

### 6. Test
- Health check: http://localhost:5000/health
- API info: http://localhost:5000

## Development Workflow

- Create feature branch: `git checkout -b feature/your-feature`
- Commit changes: `git commit -m "feat: description"`
- Push branch: `git push origin feature/your-feature`
- Create Pull Request on GitHub

## Tech Stack
- Node.js 20.x
- TypeScript 5.x
- Fastify 5.x
- Prisma 7.2
- PostgreSQL 15+