# Contributing to VerimutFS Node

Thank you for your interest in contributing to VerimutFS! This document provides guidelines and instructions for contributing.

## 🤝 How to Contribute

### Reporting Bugs

1. **Check existing issues** to see if the bug has already been reported
2. **Create a new issue** with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - System information (OS, Node version)
   - Relevant logs or screenshots

### Suggesting Features

1. **Check existing feature requests**
2. **Open a new discussion** or issue describing:
   - The problem it solves
   - How it would work
   - Why it's useful for the project

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes**
4. **Test thoroughly**
5. **Commit with clear messages**: `git commit -m "feat: add xyz feature"`
6. **Push to your fork**: `git push origin feature/your-feature-name`
7. **Open a Pull Request**

## 📝 Development Setup

### Prerequisites
- Node.js 18+
- npm 8+
- Git

### Setup Steps

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/verimutfs-node.git
cd verimutfs-node

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
```

## 🔧 Code Guidelines

### TypeScript

- Use TypeScript for all new code
- Follow existing code style
- Add types, avoid `any`
- Use interfaces for complex types

**Example:**
```typescript
interface ProfileData {
  peerId: string;
  skills: string[];
  location: GeoLocation;
}

async function publishProfile(profile: ProfileData): Promise<void> {
  // Implementation
}
```

### Code Style

- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Naming**:
  - Classes: PascalCase (`ProfileManager`)
  - Functions/variables: camelCase (`getUserProfile`)
  - Constants: UPPER_SNAKE_CASE (`DEFAULT_PORT`)
  - Private members: prefix with `_` or use `private`

### Comments

```typescript
/**
 * Search for providers near a location
 * @param lat - Latitude
 * @param lng - Longitude
 * @param radiusKm - Search radius in kilometers
 * @returns Array of matching providers
 */
async function searchNearby(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<Provider[]> {
  // Implementation
}
```

### Error Handling

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed:', error);
  throw new CustomError('User-friendly message', error);
}
```

## 🧪 Testing

### Writing Tests

```typescript
import { describe, it, expect } from 'jest';
import { CryptoUtils } from '../crypto/crypto-utils';

describe('CryptoUtils', () => {
  it('should generate valid geohash', () => {
    const geohash = CryptoUtils.geohashEncode(40.7128, -74.0060, 5);
    expect(geohash).toHaveLength(5);
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm test -- --coverage
```

## 📦 Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Build/tooling changes

**Examples:**
```
feat(indexing): add geohash-based proximity search

fix(crypto): resolve encryption key generation issue

docs(readme): update installation instructions

test(query): add unit tests for query engine
```

## 🏗️ Project Structure

```
verimutfs-node/
├── src/
│   ├── cli.ts              # Entry point
│   ├── config.ts           # Configuration
│   ├── node-manager.ts     # Node lifecycle
│   ├── crypto/             # Crypto utilities
│   ├── storage/            # Storage layer
│   ├── indexing/           # DHT indexing
│   ├── query/              # Search engine
│   ├── access/             # Access control
│   ├── protocols/          # libp2p protocols
│   └── types/              # TypeScript types
├── tests/                  # Unit tests
├── examples/               # Usage examples
└── docs/                   # Documentation
```

## 🔐 Security

### Reporting Security Issues

**Do NOT** create public issues for security vulnerabilities.

Email security@verimut.com with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Security Best Practices

- Never commit secrets or private keys
- Use environment variables for sensitive config
- Validate all user inputs
- Follow principle of least privilege
- Keep dependencies updated

## 📖 Documentation

### Code Documentation

- Document all public APIs
- Use JSDoc format
- Include examples for complex functions
- Keep docs up-to-date with code changes

### README Updates

When adding features:
- Update README.md
- Add usage examples
- Update API documentation
- Update roadmap if applicable

## 🎯 Priority Areas

We especially welcome contributions in:

1. **Performance optimization**
   - Query engine improvements
   - DHT indexing efficiency
   - Network bandwidth optimization

2. **Security enhancements**
   - Privacy features
   - Encryption improvements
   - Access control refinements

3. **Documentation**
   - Usage guides
   - API documentation
   - Code examples

4. **Testing**
   - Unit tests
   - Integration tests
   - Performance benchmarks

5. **Features**
   - Mobile support
   - Web dashboard
   - Enhanced search capabilities

## ❓ Questions?

- **GitHub Discussions**: Ask questions, share ideas
- **Discord**: Join our community server
- **Email**: dev@verimut.com

## 📜 Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Positive behavior:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community

**Unacceptable behavior:**
- Trolling, insulting/derogatory comments, personal attacks
- Public or private harassment
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

### Enforcement

Violations can be reported to conduct@verimut.com. All complaints will be reviewed and investigated promptly and fairly.

## 🙏 Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Credited in documentation

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to VerimutFS!** 🚀
