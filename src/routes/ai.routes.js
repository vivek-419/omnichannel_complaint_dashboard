const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { optionalAuth } = require('../middlewares/auth.middleware');

router.post('/draft-response', optionalAuth, aiController.generateDraft);
router.get('/root-cause-analysis', aiController.getRootCauseAnalysis);
router.post('/analyze-sentiment', aiController.analyzeSentiment);

module.exports = router;
