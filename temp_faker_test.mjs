import { faker } from '@faker-js/faker';
console.log('person methods:', Object.keys(faker.person).slice(0,10));
console.log('address methods:', Object.keys(faker.address).slice(0,10));
console.log('location methods:', Object.keys(faker.location).slice(0,10));
console.log('country method exists?', typeof faker.address?.country, typeof faker.location?.country);
console.log('city method:', faker.location.city ? faker.location.city() : (faker.address.city ? faker.address.city() : 'none'));
