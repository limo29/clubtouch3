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
  groupId: true,
  isGroupAccount: true,
  group: {
    select: {
      id: true,
      name: true,
      color: true,
      emoji: true,
      imageUrl: true,
    },
  },
};

module.exports = { CUSTOMER_BASIC_SELECT };
