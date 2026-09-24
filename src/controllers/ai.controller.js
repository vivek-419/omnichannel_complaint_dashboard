const aiService = require('../services/ai.service');
const ticketStore = require('../stores/ticket.store');

// POST /api/ai/draft-response
async function generateDraft(req, res) {
  const { ticketId, tone = 'empathetic', agentName = (req.user ? req.user.name : 'CCMRS Support Agent') } = req.body;

  if (!ticketId) {
    return res.status(400).json({ success: false, message: 'Ticket ID is required' });
  }

  const ticket = ticketStore.getTicketById(ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  try {
    const result = await aiService.generateSmartReply(ticket, { tone, agentName });
    res.json({
      success: true,
      ticketId: ticket.ticketId,
      source: result.source,
      tone: result.tone,
      suggestedSubject: result.suggestedSubject,
      draft: result.draft
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate AI draft: ' + err.message });
  }
}

// GET /api/ai/root-cause-analysis
async function getRootCauseAnalysis(req, res) {
  try {
    const tickets = ticketStore.getTickets();
    const analytics = ticketStore.getAnalyticsSummary();
    const analysis = await aiService.generateRootCauseAnalysis(tickets, analytics);
    res.json({
      success: true,
      analysis
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate root-cause analysis: ' + err.message });
  }
}

// POST /api/ai/analyze-sentiment
function analyzeSentiment(req, res) {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, message: 'Text is required for sentiment analysis' });
  }
  const result = aiService.analyzeDeepSentiment(text);
  res.json(result);
}

module.exports = {
  generateDraft,
  getRootCauseAnalysis,
  analyzeSentiment
};
