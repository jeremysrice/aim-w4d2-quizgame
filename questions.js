// Question bank. Each entry: question text, choices array, index of correct answer.
// Grouped by difficulty so the game can pull from each tier.
const QUESTION_BANK = {
  easy: [
    { q: "How many days are in a week?", choices: ["5", "6", "7", "8"], answer: 2 },
    { q: "What color is the sky on a clear day?", choices: ["Green", "Blue", "Red", "Yellow"], answer: 1 },
    { q: "What is 2 + 3?", choices: ["4", "5", "6", "7"], answer: 1 },
    { q: "Which animal says 'moo'?", choices: ["Dog", "Cat", "Cow", "Duck"], answer: 2 },
    { q: "How many legs does a dog have?", choices: ["2", "4", "6", "8"], answer: 1 },
    { q: "What do bees make?", choices: ["Milk", "Honey", "Silk", "Bread"], answer: 1 },
    { q: "What season comes after winter?", choices: ["Spring", "Summer", "Fall", "Winter"], answer: 0 },
    { q: "What color is a banana when it's ripe?", choices: ["Purple", "Blue", "Yellow", "Black"], answer: 2 },
    { q: "Which of these is a fruit?", choices: ["Carrot", "Apple", "Potato", "Onion"], answer: 1 },
    { q: "How many hours are in a day?", choices: ["12", "20", "24", "30"], answer: 2 },
    { q: "What do you use to see?", choices: ["Ears", "Eyes", "Nose", "Hands"], answer: 1 },
    { q: "Which animal is known for its long neck?", choices: ["Giraffe", "Pig", "Rabbit", "Horse"], answer: 0 },
  ],
  medium: [
    { q: "What is the capital of France?", choices: ["Berlin", "Madrid", "Paris", "Rome"], answer: 2 },
    { q: "Which planet is known as the Red Planet?", choices: ["Venus", "Mars", "Jupiter", "Saturn"], answer: 1 },
    { q: "What color do you get by mixing blue and yellow?", choices: ["Green", "Purple", "Orange", "Brown"], answer: 0 },
    { q: "What is 9 × 3?", choices: ["24", "27", "29", "21"], answer: 1 },
    { q: "Which animal is known as the 'King of the Jungle'?", choices: ["Tiger", "Elephant", "Lion", "Gorilla"], answer: 2 },
    { q: "How many continents are there?", choices: ["5", "6", "7", "8"], answer: 2 },
    { q: "Which ocean is the largest?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], answer: 3 },
    { q: "How many legs does a spider have?", choices: ["6", "8", "10", "12"], answer: 1 },
    { q: "What is the freezing point of water in Celsius?", choices: ["0°", "32°", "10°", "-10°"], answer: 0 },
    { q: "What is the largest animal on Earth?", choices: ["Elephant", "Blue whale", "Shark", "Giraffe"], answer: 1 },
    { q: "How many minutes are in an hour?", choices: ["30", "60", "90", "100"], answer: 1 },
    { q: "What gas do people need to breathe to live?", choices: ["Oxygen", "Helium", "Carbon dioxide", "Hydrogen"], answer: 0 },
  ],
  hard: [
    { q: "Who painted the Mona Lisa?", choices: ["Michelangelo", "Raphael", "Leonardo da Vinci", "Donatello"], answer: 2 },
    { q: "In what year did humans first land on the Moon?", choices: ["1965", "1969", "1972", "1959"], answer: 1 },
    { q: "What is the largest organ of the human body?", choices: ["Liver", "Skin", "Brain", "Lungs"], answer: 1 },
    { q: "What is the square root of 144?", choices: ["11", "12", "13", "14"], answer: 1 },
    { q: "What gas do plants absorb from the air?", choices: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], answer: 2 },
    { q: "Who wrote 'Romeo and Juliet'?", choices: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], answer: 1 },
    { q: "What is the capital of Australia?", choices: ["Sydney", "Melbourne", "Canberra", "Perth"], answer: 2 },
    { q: "What is the chemical symbol for water?", choices: ["H2O", "CO2", "O2", "NaCl"], answer: 0 },
    { q: "Who developed the theory of relativity?", choices: ["Isaac Newton", "Niels Bohr", "Albert Einstein", "Max Planck"], answer: 2 },
    { q: "What is the smallest prime number?", choices: ["0", "1", "2", "3"], answer: 2 },
    { q: "Which country is home to the kangaroo?", choices: ["Brazil", "Australia", "India", "Canada"], answer: 1 },
    { q: "What does HTML stand for?", choices: ["HyperText Markup Language", "High Tech Modern Language", "Home Tool Markup Language", "Hyperlink Text Mode Language"], answer: 0 },
  ],
};

// Lets the Node unit tests load this file; ignored in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { QUESTION_BANK };
}
