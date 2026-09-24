const PRIORITIES = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
};

const CATEGORIES = {
  DELAYED_DELIVERY: 'Delayed Delivery',
  DAMAGED_ITEM: 'Damaged / Defective Item',
  BILLING_REFUND: 'Billing & Refund',
  TECHNICAL_ISSUE: 'App Technical Issue',
  GENERAL_INQUIRY: 'General Inquiry'
};

const SENTIMENTS = {
  POSITIVE: 'Positive',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negative'
};

const CHANNELS = {
  GMAIL: 'gmail',
  TELEGRAM: 'telegram',
  DISCORD: 'discord'
};

const STATUSES = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  ESCALATED: 'Escalated',
  CLOSED: 'Closed'
};

module.exports = {
  PRIORITIES,
  CATEGORIES,
  SENTIMENTS,
  CHANNELS,
  STATUSES
};
