import { faker } from '@faker-js/faker';
console.log('has person?', !!faker.person);
console.log('person firstName', typeof faker.person.firstName);
console.log('has location?', !!faker.location);
console.log('location city?', typeof faker.location.city);
console.log('has number?', !!faker.number);
console.log('number int?', typeof faker.number.int);
console.log('has datatype?', !!faker.datatype);
