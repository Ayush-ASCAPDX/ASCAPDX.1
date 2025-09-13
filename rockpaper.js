    let playerScore = 0;
let computerScore = 0;
const winningScore = 3;

const clickSound = new Audio('click.mp3');
const winSound = new Audio('win.mp3');
const loseSound = new Audio('lose.mp3');

const icons = {
  rock: "🪨",
  paper: "📄",
  scissors: "✂️"
};
function animateScore(element, start, end, duration = 400) {
  const range = end - start;
  let startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    element.textContent = `You: ${Math.floor(start + range * progress)} | Computer: ${Math.floor(end - (range - range * progress))}`;
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}


function play(playerChoice) {
  clickSound.currentTime = 0;
  clickSound.play();

  const vsText = document.getElementById('vsText');
vsText.classList.remove('vs-bounce'); // remove old animation
void vsText.offsetWidth;              // trigger reflow
vsText.classList.add('vs-bounce');    // start new animation

  let prevPlayerScore = playerScore;
let prevComputerScore = computerScore;

  if (playerScore === winningScore || computerScore === winningScore) return;

  const choices = ['rock', 'paper', 'scissors'];
  const computerChoice = choices[Math.floor(Math.random() * 3)];

  // show chosen cards in battle area
  const playerPick = document.getElementById('playerPick');
  const computerPick = document.getElementById('computerPick');

  playerPick.textContent = icons[playerChoice];
  computerPick.textContent = icons[computerChoice];

  playerPick.classList.remove('show-pick');
  computerPick.classList.remove('show-pick');
  void playerPick.offsetWidth; // trigger reflow
  void computerPick.offsetWidth;

  playerPick.classList.add('show-pick');
  computerPick.classList.add('show-pick');

  // Remove old slide animations
playerPick.classList.remove('slide-in-left');
computerPick.classList.remove('slide-in-right');
void playerPick.offsetWidth;   // trigger reflow
void computerPick.offsetWidth;

// Add slide-in animation
playerPick.classList.add('slide-in-left');
computerPick.classList.add('slide-in-right');

  let result = '';
// Remove old animation classes first
playerPick.classList.remove('win-flash', 'lose-shake', 'tie-flash');
computerPick.classList.remove('win-flash', 'lose-shake', 'tie-flash');
void playerPick.offsetWidth; // reflow to restart animation
void computerPick.offsetWidth;

if (playerChoice === computerChoice) {
  result = "It's a tie!";
  playerPick.classList.add('tie-bg');
  computerPick.classList.add('tie-bg');
  playerPick.classList.add('tie-flash');
  computerPick.classList.add('tie-flash');
} else if (
  (playerChoice === 'rock' && computerChoice === 'scissors') ||
  (playerChoice === 'paper' && computerChoice === 'rock') ||
  (playerChoice === 'scissors' && computerChoice === 'paper')
) {
  playerScore++;
  winSound.currentTime = 0;
  winSound.play();
  result = `You win this round! ${playerChoice} beats ${computerChoice}`;
  playerPick.classList.add('win-bg', 'win-flash');    // green background & flash
  computerPick.classList.add('lose-bg', 'lose-shake'); // red background & shake
} else {
  computerScore++;
  loseSound.currentTime = 0;
  loseSound.play();
  result = `You lose this round! ${computerChoice} beats ${playerChoice}`;
  computerPick.classList.add('win-bg', 'win-flash');    // green background & flash
  playerPick.classList.add('lose-bg', 'lose-shake');   // red background & shake
}

// Reset backgrounds after 1 second
setTimeout(() => {
  playerPick.classList.remove('win-bg', 'lose-bg', 'tie-bg', 'win-flash', 'lose-shake', 'tie-flash');
  computerPick.classList.remove('win-bg', 'lose-bg', 'tie-bg', 'win-flash', 'lose-shake', 'tie-flash');
}, 1000);



  document.getElementById('scoreboard').textContent =
  `You: ${playerScore} | Computer: ${computerScore}`;

  let finalMessage = '';
if (playerScore === winningScore) {
  finalMessage = "<br><strong>🎉 You won the game!</strong>";
  document.getElementById('vsText').textContent = '🏆';
  disableCards();
  showPlayAgain();
} else if (computerScore === winningScore) {
  finalMessage = "<br><strong>💻 Computer won the game!</strong>";
  document.getElementById('vsText').textContent = '🏆';
  disableCards();
  showPlayAgain();
}



  const resultDiv = document.getElementById('result');
  resultDiv.classList.remove('fade');
  void resultDiv.offsetWidth;
  resultDiv.classList.add('fade');

  resultDiv.innerHTML = `
    <p>${result}</p>
    <p>Score — You: ${playerScore} | Computer: ${computerScore}</p>
    ${finalMessage}
  `;
  if (playerScore === winningScore) {
  finalMessage = "<br><strong>🎉 You won the game!</strong>";
  showPlayAgain();
} else if (computerScore === winningScore) {
  finalMessage = "<br><strong>💻 Computer won the game!</strong>";
  showPlayAgain();
}

}
function showPlayAgain() {
  document.getElementById('playAgainContainer').innerHTML =
    '<button onclick="resetGame()">🔁 Play Again</button>';
}

function resetGame() {
  playerScore = 0;
  computerScore = 0;
  document.getElementById('result').innerHTML = '';
  document.getElementById('playerPick').textContent = '❓';
  document.getElementById('computerPick').textContent = '❓';
  document.getElementById('playAgainContainer').innerHTML = '';
  document.getElementById('vsText').textContent = 'VS';
  document.getElementById('scoreboard').textContent = `You: 0 | Computer: 0`;
  document.getElementById('playerPick').classList.remove('win-bg', 'lose-bg', 'tie-bg', 'win-flash', 'lose-shake', 'tie-flash');
document.getElementById('computerPick').classList.remove('win-bg', 'lose-bg', 'tie-bg', 'win-flash', 'lose-shake', 'tie-flash');

  enableCards();

}




// function resetGame() {
//   playerScore = 0;
//   computerScore = 0;
//   document.getElementById('result').innerHTML = '';
//   document.getElementById('playerPick').textContent = '❓';
//   document.getElementById('computerPick').textContent = '❓';
// }


function disableCards() {
  document.querySelectorAll('.card').forEach(card => {
    card.style.pointerEvents = 'none';
    card.style.opacity = '0.5';
  });
}

function enableCards() {
  document.querySelectorAll('.card').forEach(card => {
    card.style.pointerEvents = 'auto';
    card.style.opacity = '1';
  });
}

