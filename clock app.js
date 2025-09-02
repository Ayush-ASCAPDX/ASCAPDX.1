let hrs = document.getElementById("hrs");
let min = document.getElementById("min");
let sec = document.getElementById("sec");



setInterval(() => {
    let currentTime = new Date();

    hrs.innerHTML = [currentTime.getHours() < 10 ? "0" : ""] + currentTime.getHours();
    min.innerHTML = [currentTime.getMinutes() < 10 ? "0" : ""] + currentTime.getMinutes();
    sec.innerHTML = [currentTime.getSeconds() < 10 ? "0" : ""] + currentTime.getSeconds();
}, 1000)


let [seconds, minutes, hours] = [0, 0, 0];
let displayTime = document.getElementById("displayTime");
let timer = null;

function stopwatch() {
    seconds++;
    if (seconds == 60) {
        seconds = 0;
        minutes++;
        if (minutes == 60) {
            minutes = 0;
            hours++;
        }

    }

    let h = hours < 10 ? "0" + hours : hours;
    let m = minutes < 10 ? "0" + minutes : minutes;
    let s = seconds < 10 ? "0" + seconds : seconds;

    displayTime.innerHTML = h + ":" + m + ":" + s;
}

function watchStart() {
    if (timer !== null) {
        clearInterval(timer);
    }
    timer = setInterval(stopwatch, 1000);
}

function watchreset() {
    clearInterval(timer);
    [seconds, minutes, hours] = [0, 0, 0];
    displayTime.innerHTML = "00:00:00";
}

const questions = [
    {
        question: "are you ready?",
        answer: [
            { text: "no", correct: false },
            { text: "yes", correct: true },

        ]
    },
    
    
    {
        question: "P.T. me kitane groups hote hai?",
        answer: [
            { text: "11", correct: false },
            { text: "12 ", correct: false },
            { text: "7", correct: false },
            { text: "18", correct: true },
        ]
    },
    
    {
        question: "P.T. me 2nd groupe kitane Element hote hai?",
        answer: [
            { text: "112", correct: false },
            { text: "7 ", correct: false },
            { text: "6", correct: true },
            { text: "18", correct: false },
        ]
    },
    
    {
        question: "P.T. me kitane period hote hai?",
        answer: [
            { text: "12", correct: false },
            { text: "7 ", correct: true },
            { text: "66", correct: false },
            { text: "18", correct: false },
        ]
    },
    {
        question: "1st ग्रुप के तत्व है?",
        answer: [
            { text: "H , He , Li , Be , B , C , N ", correct: false },
            { text: "H , Li , Na , K , Rb , Cs , Fr ", correct: true },
            { text: "H , Li , Na , K , Rb , Be", correct: false },
            { text: "He , Li , Na , K , Rb , Cs", correct: false },
        ]
    },
    {
        question: "पी.टी. me किस समूह के तत्व को क्षारीय मृदा धातु कहते हैं?",
        answer: [
            { text: "1", correct: true },
            { text: "2 ", correct: false },
            { text: "16", correct: false },
            { text: "18", correct: false },
        ]
    },
    {
        question: "किसे 'उपधातु' का ज्ञान नहीं था?",
        answer: [
            { text: "Lavoisier", correct: true },
            { text: "Daulton", correct: false },
            { text: "Doberiner", correct: false },
            { text: "Lother-meyer", correct: false },
        ]
    },
    {
        question: "16th group के element है-",
        answer: [
            { text: "O , S , Se , Te , Po", correct: true },
            { text: "He , Li , Na , Rb , Fr ", correct: false },
            { text: "H , Kr , K , Rb , Be ", correct: false },
            { text: "H , Mg , Li , Na ,K , Rb , Cs", correct: false },
        ]
    },
    {
        question: "'Ashtak Niyam' kisane diya tha?",
        answer: [
            { text: "Mendleev", correct: false },
            { text: "Daberiner", correct: false },
            { text: "Newlands", correct: true },
            { text: "lavoisier", correct: false },
        ]
    },
    {
        question: " p-block ke element hai kis groupe-",
        answer: [
            { text: "13 - 18", correct: true },
            { text: "3 - 12 ", correct: false },
            { text: "1 - 19", correct: false },
            { text: "21 - 13", correct: false },
        ]
    },
    {
        question: " 'B , Al , Ga , In , Tl 'element hai kis groupe -",
        answer: [
            { text: "13 - 18", correct: false },
            { text: "13 ", correct: true },
            { text: "11", correct: false },
            { text: "15", correct: false },
        ]
    },
    {
        question: " d-block के element है-",
        answer: [
            { text: "1 - 2", correct: false },
            { text: "3 - 12 ", correct: true },
            { text: "12 - 19", correct: false },
            { text: "2 - 13", correct: false },
        ]
    },

];


const questionElement = document.getElementById("question");
const answerButtons = document.getElementById("answer-buttons");
const nextButton = document.getElementById("next-btn");
const previousButton = document.getElementById("previous-btn")

let currentQuestionIndex = 0;
let score = 0;

function startQuiz() {
    currentQuestionIndex = 0;
    score = 0;
    nextButton.innerHTML = "Next";
    showQuestion();
}

function showQuestion() {
    resetState();

    let currentQuestion = questions[currentQuestionIndex];
    let questionNo = currentQuestionIndex + 1;
    questionElement.innerHTML = questionNo + ". " + currentQuestion.question;

    currentQuestion.answer.forEach(answer => {
        const button = document.createElement("button");
        button.innerHTML = answer.text;
        button.classList.add("btn")
        answerButtons.appendChild(button);
        if (answer.correct) {
            button.dataset.correct = answer.correct;
        }
        button.addEventListener("click", selectAnswer);
    });
}

function resetState() {
    nextButton.style.display = "none";
    while (answerButtons.firstChild) {
        answerButtons.removeChild(answerButtons.firstChild);

    }
}

function selectAnswer(e) {
    const selectedBtn = e.target;
    const isCorrect = selectedBtn.dataset.correct === "true";
    if (isCorrect) {
        selectedBtn.classList.add("correct");
        score++;
    } else {
        selectedBtn.classList.add("incorrect");
    }
    Array.from(answerButtons.children).forEach(button => {
        if (button.dataset.correct === "true") {
            button.classList.add("correct");
        }
        button.disabled = true;
    })
    nextButton.style.display = "inline";
}

function showScore() {
    resetState();
    questionElement.innerHTML = `You scored ${score} out of ${questions.length}!`;
    nextButton.innerHTML = "Restart";
    nextButton.style.display = "inline"
}

function handleNextButton() {
    currentQuestionIndex++;
    if (currentQuestionIndex < questions.length) {
        showQuestion();
    } else {
        showScore();
    }
}


nextButton.addEventListener("click", () => {
    if (currentQuestionIndex < questions.length) {
        handleNextButton();
    } else {
        startQuiz();
    }
});

function handlePreviousButton() {
    currentQuestionIndex--;
    if (currentQuestionIndex < questions.length) {
        showQuestion();
    } else {

        showQuestion(currentQuestionIndex);
    }
}

previousButton.addEventListener("click", () => {
    if (currentQuestionIndex < questions.length) {
        handlePreviousButton();
    } else {
        startQuiz();
    }
});

showQuestion();