// Kundenfelder ohne Kontaktdaten (company, street, zip, city, phone, email).
// Für jede Relation, die an Kassierer oder über den Socket ausgeliefert wird,
// statt `customer: true` verwenden; Kontaktdaten gibt nur customerController
// an ADMIN/ACCOUNTANT heraus.
const CUSTOMER_BASIC_SELECT = {
  id: true,
  name: true,
  nickname: true,
  balance: true,
  gender: true,
  active: true,
  lastActivity: true,
  createdAt: true,
  updatedAt: true,
};

module.exports = { CUSTOMER_BASIC_SELECT };
